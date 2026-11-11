#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOCFPlugIn.h>
#include <IOKit/IOKitLib.h>
#include <IOKit/usb/IOUSBLib.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum { STREAM_SLOTS = 12, STREAM_FRAME = 87 * 188 };

struct stream_slot {
    uint8_t data[STREAM_FRAME];
    UInt32 size;
    IOReturn status;
    Boolean done;
};

struct a835_usb {
    IOUSBInterfaceInterface550 **interface;
    UInt8 command_out, command_in, transport;
    CFRunLoopSourceRef source;
    struct stream_slot slots[STREAM_SLOTS];
    unsigned int next_slot;
};

static void stream_complete(void *refcon, IOReturn status, void *bytes) {
    struct stream_slot *slot = refcon;
    slot->size = (UInt32)(uintptr_t)bytes;
    slot->status = status;
    slot->done = true;
}

static IOReturn submit(struct a835_usb *usb, struct stream_slot *slot) {
    slot->done = false;
    IOReturn status = (*usb->interface)->ReadPipeAsyncTO(
        usb->interface, usb->transport, slot->data, STREAM_FRAME,
        1000, 1000, stream_complete, slot);
    if (status != kIOReturnSuccess) stream_complete(slot, status, NULL);
    return status;
}

static void stop_stream(struct a835_usb *usb) {
    if (!usb->source) return;
    (*usb->interface)->AbortPipe(usb->interface, usb->transport);
    for (unsigned int i = 0; i < STREAM_SLOTS; ++i) {
        while (!usb->slots[i].done)
            CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.25, true);
    }
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), usb->source, kCFRunLoopDefaultMode);
    CFRelease(usb->source);
    usb->source = NULL;
}

static IOReturn start_stream(struct a835_usb *usb) {
    IOReturn status = (*usb->interface)->CreateInterfaceAsyncEventSource(usb->interface, &usb->source);
    if (status != kIOReturnSuccess) return status;
    CFRunLoopAddSource(CFRunLoopGetCurrent(), usb->source, kCFRunLoopDefaultMode);
    usb->next_slot = 0;
    for (unsigned int i = 0; i < STREAM_SLOTS; ++i) submit(usb, &usb->slots[i]);
    return kIOReturnSuccess;
}

static int number(io_registry_entry_t entry, CFStringRef key) {
    CFTypeRef value = IORegistryEntryCreateCFProperty(entry, key, kCFAllocatorDefault, 0);
    int number = -1;
    if (value) {
        if (CFGetTypeID(value) == CFNumberGetTypeID())
            CFNumberGetValue(value, kCFNumberIntType, &number);
        CFRelease(value);
    }
    return number;
}

void a835_close(struct a835_usb *usb) {
    if (!usb) return;
    stop_stream(usb);
    IOUSBInterfaceInterface550 **interface = usb->interface;
    (*interface)->USBInterfaceClose(interface);
    (*interface)->Release(interface);
    free(usb);
}

int32_t a835_open(struct a835_usb **result) {
    io_iterator_t iter;
    IOReturn error = IOServiceGetMatchingServices(kIOMainPortDefault,
        IOServiceMatching("IOUSBHostInterface"), &iter);
    if (error != kIOReturnSuccess) return error;
    error = kIOReturnNotFound;
    io_service_t service;
    while ((service = IOIteratorNext(iter))) {
        int vendor = number(service, CFSTR("idVendor"));
        int product = number(service, CFSTR("idProduct"));
        if (vendor != 0x07ca || product != 0xa835) {
            IOObjectRelease(service);
            continue;
        }

        IOCFPlugInInterface **plugin = NULL;
        SInt32 score;
        error = IOCreatePlugInInterfaceForService(service, kIOUSBInterfaceUserClientTypeID,
            kIOCFPlugInInterfaceID, &plugin, &score);
        IOObjectRelease(service);
        if (error != kIOReturnSuccess) continue;
        IOUSBInterfaceInterface550 **interface = NULL;
        HRESULT query = (*plugin)->QueryInterface(plugin,
            CFUUIDGetUUIDBytes(kIOUSBInterfaceInterfaceID550), (LPVOID *)&interface);
        IODestroyPlugInInterface(plugin);
        if (query || !interface) {
            error = kIOReturnUnsupported;
            continue;
        }

        error = (*interface)->USBInterfaceOpen(interface);
        if (error != kIOReturnSuccess) {
            (*interface)->Release(interface);
            continue;
        }
        struct a835_usb *usb = calloc(1, sizeof(*usb));
        if (!usb) {
            (*interface)->USBInterfaceClose(interface);
            (*interface)->Release(interface);
            error = kIOReturnNoMemory;
            break;
        }
        usb->interface = interface;
        UInt8 count;
        error = (*interface)->GetNumEndpoints(interface, &count);
        if (error == kIOReturnSuccess) {
            for (UInt8 pipe = 1; pipe <= count; ++pipe) {
                UInt8 direction, endpoint, type, interval;
                UInt16 packet;
                if ((*interface)->GetPipeProperties(interface, pipe, &direction,
                    &endpoint, &type, &packet, &interval) != kIOReturnSuccess || type != kUSBBulk)
                    continue;
                if (direction == kUSBOut && endpoint == 2) usb->command_out = pipe;
                if (direction == kUSBIn && endpoint == 1) usb->command_in = pipe;
                if (direction == kUSBIn && endpoint == 4) usb->transport = pipe;
            }
            if (usb->command_out && usb->command_in && usb->transport) {
                *result = usb;
                break;
            }
            error = kIOReturnNotFound;
        }
        a835_close(usb);
    }
    IOObjectRelease(iter);
    return error;
}

int32_t a835_write(struct a835_usb *usb, void *bytes, uint32_t size) {
    return (*usb->interface)->WritePipeTO(usb->interface, usb->command_out, bytes, size, 2000, 2000);
}

void a835_reset_stream(struct a835_usb *usb) {
    stop_stream(usb);
}

int32_t a835_read(struct a835_usb *usb, int transport, void *bytes, uint32_t *size, uint32_t timeout) {
    if (!transport)
        return (*usb->interface)->ReadPipeTO(usb->interface, usb->command_in, bytes, size, timeout, timeout);
    if (!usb->source) {
        IOReturn status = start_stream(usb);
        if (status != kIOReturnSuccess) return status;
    }
    struct stream_slot *slot = &usb->slots[usb->next_slot];
    double end = CFAbsoluteTimeGetCurrent() + (double)timeout / 1000;
    while (!slot->done) {
        double remaining = end - CFAbsoluteTimeGetCurrent();
        if (remaining <= 0) {
            *size = 0;
            return kIOReturnTimeout;
        }
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, remaining, true);
    }
    IOReturn status = slot->status;
    if (slot->size < *size) *size = slot->size;
    memcpy(bytes, slot->data, *size);
    submit(usb, slot);
    usb->next_slot = (usb->next_slot + 1) % STREAM_SLOTS;
    return status;
}
