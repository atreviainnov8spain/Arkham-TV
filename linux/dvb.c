#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <linux/dvb/dmx.h>
#include <linux/dvb/frontend.h>
#include <math.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
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

enum { TERRESTRIAL_T = 1, TERRESTRIAL_T2 = 2 };

static int terrestrial_systems(int frontend) {
    struct dtv_property property = { .cmd = DTV_ENUM_DELSYS };
    struct dtv_properties properties = { 1, &property };
    if (ioctl(frontend, FE_GET_PROPERTY, &properties) < 0) {
        // Legacy OFDM frontends can report DVB-T through the DVBv3 API.
        struct dvb_frontend_info info = {0};
        if (ioctl(frontend, FE_GET_INFO, &info) < 0) return -1;
        return info.type == FE_OFDM ? TERRESTRIAL_T : 0;
    }
    int systems = 0;
    for (unsigned i = 0; i < property.u.buffer.len && i < sizeof(property.u.buffer.data); i++) {
        if (property.u.buffer.data[i] == SYS_DVBT) systems |= TERRESTRIAL_T;
        if (property.u.buffer.data[i] == SYS_DVBT2) systems |= TERRESTRIAL_T2;
    }
    return systems;
}

static int frontend_info(const char *path) {
    int frontend = open(path, O_RDONLY | O_NONBLOCK);
    if (frontend < 0) return fail("Apertura del sintonizador DVB");
    int systems = terrestrial_systems(frontend);
    if (systems < 0) return fail("Consulta de capacidades DVB");
    struct dvb_frontend_info info = {0};
    int result = ioctl(frontend, FE_GET_INFO, &info);
    close(frontend);
    if (!systems) return 2;
    if (result < 0) info.name[0] = '\0';
    printf("%s%s\n%.*s\n", systems & TERRESTRIAL_T ? "DVB-T" : "",
           systems & TERRESTRIAL_T2 ? (systems & TERRESTRIAL_T ? " DVB-T2" : "DVB-T2") : "",
           (int)sizeof(info.name), info.name);
    return 0;
}

// Return 1 for lock, 0 for no signal and -1 for a rejected tune request.
static int tune_frontend(int frontend, int uhf, int seconds, enum fe_delivery_system system) {
    struct dtv_property tune[] = {
        { .cmd = DTV_CLEAR },
        { .cmd = DTV_DELIVERY_SYSTEM, .u.data = system },
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
    if (ioctl(frontend, FE_SET_PROPERTY, &properties) < 0) return -1;

    long long deadline = milliseconds() + (seconds ? 2500 : 5000);
    while (milliseconds() < deadline) {
        fe_status_t status = 0;
        if (ioctl(frontend, FE_READ_STATUS, &status) < 0) return -1;
        if (status & FE_HAS_LOCK) return 1;
        nanosleep(&(struct timespec){ .tv_nsec = 100000000 }, NULL);
    }
    return 0;
}

static double frontend_cnr(int frontend) {
    struct dtv_property property = { .cmd = DTV_STAT_CNR };
    struct dtv_properties properties = { 1, &property };
    if (ioctl(frontend, FE_GET_PROPERTY, &properties) < 0 ||
        !property.u.st.len || property.u.st.stat[0].scale != FE_SCALE_DECIBEL)
        return NAN;
    return property.u.st.stat[0].svalue / 1000.0;
}

int main(int argc, char **argv) {
    if (argc == 3 && strcmp(argv[1], "--info") == 0) return frontend_info(argv[2]);
    if (argc != 6) {
        fprintf(stderr, "Uso: arkham-dvb FRONTEND DEMUX DVR UHF SEGUNDOS | --info FRONTEND\n");
        return 1;
    }
    const int uhf = atoi(argv[4]);
    const int seconds = atoi(argv[5]);
    if (uhf < 21 || uhf > 48 || seconds < 0 || seconds > 10) return 1;

    int frontend = open(argv[1], O_RDWR | O_NONBLOCK);
    if (frontend < 0) return fail("Apertura del sintonizador DVB");
    int systems = terrestrial_systems(frontend);
    if (systems < 0) return fail("Consulta de capacidades DVB");
    if (!systems) {
        fputs("El sintonizador no admite DVB-T ni DVB-T2.\n", stderr);
        return 1;
    }
    int dvbt = systems & TERRESTRIAL_T ? tune_frontend(frontend, uhf, seconds, SYS_DVBT) : -1;
    int dvbt2 = dvbt != 1 && (systems & TERRESTRIAL_T2)
        ? tune_frontend(frontend, uhf, seconds, SYS_DVBT2) : -1;
    if (dvbt < 0 && dvbt2 < 0) return fail("Sintonización DVB");
    if (dvbt != 1 && dvbt2 != 1) {
        fputs("RF LOST\n", stderr);
        fprintf(stderr, "No se obtuvo señal %s en UHF %d.\n",
                systems & TERRESTRIAL_T2 ? (systems & TERRESTRIAL_T ? "DVB-T/T2" : "DVB-T2") : "DVB-T", uhf);
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

    long long deadline = milliseconds() + seconds * 1000LL;
    struct pollfd source = { .fd = dvr, .events = POLLIN };
    char buffer[188 * 348];
    int locked = 1;
    double previous_cnr = NAN;
    long long next_status = milliseconds() + 1000;
    fputs("RF LOCKED\n", stderr);
    while (!seconds || milliseconds() < deadline) {
        long long now = milliseconds();
        if (!seconds && now >= next_status) {
            fe_status_t status = 0;
            if (ioctl(frontend, FE_READ_STATUS, &status) < 0) return fail("Lectura de la señal DVB-T");
            int signal_locked = !!(status & FE_HAS_LOCK);
            if (signal_locked != locked) {
                fputs(signal_locked ? "RF LOCKED\n" : "RF LOST\n", stderr);
                locked = signal_locked;
                previous_cnr = NAN;
            }
            if (locked) {
                double cnr = frontend_cnr(frontend);
                if (isnan(cnr)) {
                    if (!isnan(previous_cnr)) fputs("RF CNR UNAVAILABLE\n", stderr);
                } else if (isnan(previous_cnr) || fabs(cnr - previous_cnr) >= 0.1) {
                    fprintf(stderr, "RF CNR %.1f\n", cnr);
                    previous_cnr = cnr;
                }
                if (isnan(cnr)) previous_cnr = NAN;
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
