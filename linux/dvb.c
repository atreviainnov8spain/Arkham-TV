#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <linux/dvb/dmx.h>
#include <linux/dvb/frontend.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

static long long milliseconds(void) {
    struct timespec now;
    clock_gettime(CLOCK_MONOTONIC, &now);
    return now.tv_sec * 1000LL + now.tv_nsec / 1000000;
}

static int fail(const char *operation) {
    perror(operation);
    return 1;
}

int main(int argc, char **argv) {
    if (argc != 6) {
        fprintf(stderr, "Uso: arkham-dvb FRONTEND DEMUX DVR UHF SEGUNDOS\n");
        return 1;
    }
    const int uhf = atoi(argv[4]);
    const int seconds = atoi(argv[5]);
    if (uhf < 21 || uhf > 48 || seconds < 0 || seconds > 10) return 1;

    int frontend = open(argv[1], O_RDWR | O_NONBLOCK);
    if (frontend < 0) return fail("Apertura del sintonizador DVB");
    struct dtv_property tune[] = {
        { .cmd = DTV_CLEAR },
        { .cmd = DTV_DELIVERY_SYSTEM, .u.data = SYS_DVBT },
        { .cmd = DTV_FREQUENCY, .u.data = 474000000U + (uhf - 21) * 8000000U },
        { .cmd = DTV_BANDWIDTH_HZ, .u.data = 8000000 },
        { .cmd = DTV_INVERSION, .u.data = INVERSION_AUTO },
        { .cmd = DTV_MODULATION, .u.data = QAM_AUTO },
        { .cmd = DTV_CODE_RATE_HP, .u.data = FEC_AUTO },
        { .cmd = DTV_CODE_RATE_LP, .u.data = FEC_AUTO },
        { .cmd = DTV_GUARD_INTERVAL, .u.data = GUARD_INTERVAL_AUTO },
        { .cmd = DTV_TRANSMISSION_MODE, .u.data = TRANSMISSION_MODE_AUTO },
        { .cmd = DTV_HIERARCHY, .u.data = HIERARCHY_AUTO },
        { .cmd = DTV_TUNE },
    };
    struct dtv_properties properties = { sizeof(tune) / sizeof(tune[0]), tune };
    if (ioctl(frontend, FE_SET_PROPERTY, &properties) < 0) return fail("Sintonización DVB-T");

    long long deadline = milliseconds() + (seconds ? 2500 : 5000);
    fe_status_t status = 0;
    while (milliseconds() < deadline) {
        if (ioctl(frontend, FE_READ_STATUS, &status) < 0) return fail("Lectura de la señal DVB-T");
        if (status & FE_HAS_LOCK) break;
        nanosleep(&(struct timespec){ .tv_nsec = 100000000 }, NULL);
    }
    if (!(status & FE_HAS_LOCK)) {
        fputs("RF LOST\n", stderr);
        fprintf(stderr, "No se obtuvo señal DVB-T en UHF %d.\n", uhf);
        return 2;
    }

    int demux = open(argv[2], O_RDWR | O_NONBLOCK);
    if (demux < 0) return fail("Apertura del demultiplexor DVB");
    int dvr = open(argv[3], O_RDONLY | O_NONBLOCK);
    if (dvr < 0) return fail("Apertura del flujo DVB");
    ioctl(dvr, DMX_SET_BUFFER_SIZE, 4UL * 1024 * 1024);
    // PID 0x2000 is the Linux DVB wildcard for the full transport stream.
    struct dmx_pes_filter_params filter = {
        .pid = 0x2000, .input = DMX_IN_FRONTEND, .output = DMX_OUT_TS_TAP,
        .pes_type = DMX_PES_OTHER, .flags = DMX_IMMEDIATE_START,
    };
    if (ioctl(demux, DMX_SET_PES_FILTER, &filter) < 0) return fail("Activación del flujo DVB");

    deadline = milliseconds() + seconds * 1000LL;
    struct pollfd source = { .fd = dvr, .events = POLLIN };
    char buffer[188 * 348];
    int locked = 1;
    long long next_status = milliseconds() + 1000;
    fputs("RF LOCKED\n", stderr);
    while (!seconds || milliseconds() < deadline) {
        long long now = milliseconds();
        if (!seconds && now >= next_status) {
            if (ioctl(frontend, FE_READ_STATUS, &status) < 0) return fail("Lectura de la señal DVB-T");
            int signal_locked = !!(status & FE_HAS_LOCK);
            if (signal_locked != locked) {
                fputs(signal_locked ? "RF LOCKED\n" : "RF LOST\n", stderr);
                locked = signal_locked;
            }
            next_status = now + 1000;
        }
        int ready = poll(&source, 1, 250);
        if (ready < 0 && errno == EINTR) continue;
        if (ready < 0) return fail("Espera del flujo DVB");
        if (!ready) continue;
        ssize_t length = read(dvr, buffer, sizeof(buffer));
        if (length < 0 && (errno == EINTR || errno == EAGAIN || errno == EOVERFLOW)) continue;
        if (length < 0) return fail("Lectura del flujo DVB");
        if (!length) break;
        for (ssize_t sent = 0; sent < length;) {
            ssize_t written = write(STDOUT_FILENO, buffer + sent, length - sent);
            if (written < 0 && errno == EINTR) continue;
            if (written <= 0) return fail("Salida del flujo DVB");
            sent += written;
        }
    }
    return 0;
}
