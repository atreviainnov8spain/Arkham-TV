#define _POSIX_C_SOURCE 200809L
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include "payload.h"

int main(int argc, char **argv) {
    char executable[4096];
    ssize_t length = readlink("/proc/self/exe", executable, sizeof(executable) - 1);
    if (length < 0 || length >= (ssize_t)sizeof(executable) - 1) {
        fputs("No se pudo localizar el ejecutable de Arkham TV.\n", stderr);
        return 1;
    }
    executable[length] = '\0';
    char **args = calloc((size_t)argc + 6, sizeof(*args));
    if (!args) return 1;
    args[0] = "/bin/sh";
    args[1] = "-c";
    args[2] = ARKHAM_SCRIPT;
    args[3] = "Arkham TV";
    args[4] = executable;
    args[5] = ARKHAM_PAYLOAD_SIZE;
    for (int i = 1; i < argc; ++i) args[i + 5] = argv[i];
    execv(args[0], args);
    perror("Arkham TV");
    return 1;
}
