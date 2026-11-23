#include <errno.h>
#include <limits.h>
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>
#include <unistd.h>

// Q uses this non-setuid binary for a fixed, bounded process probe. It never
// reads argument vectors, environment data, files, or another process memory.
int main(int argc, char **argv) {
    static const char *expected[] = {"-p", "-o", "pid=", "-o", "uid=", "-o", "gid=", "-o", "comm="};
    if (argc != 11 || getuid() <= 399 || geteuid() != getuid() || getegid() != getgid()) return 64;
    if (strcmp(argv[1], expected[0]) != 0) return 64;
    for (int i = 1; i < 9; i++) {
        if (strcmp(argv[i + 2], expected[i]) != 0) return 64;
    }
    char *tail;
    errno = 0;
    long pid = strtol(argv[2], &tail, 10);
    if (errno || tail == argv[2] || *tail != '\0' || pid < 2 || pid > INT_MAX) return 64;
    char canonical[32];
    snprintf(canonical, sizeof canonical, "%ld",pid);
    if (strcmp(canonical,argv[2]) != 0) return 64;

    int selector[] = {CTL_KERN,KERN_PROC,KERN_PROC_PID,(int)pid};
    struct kinfo_proc process;
    size_t length = sizeof process;
    if (sysctl(selector,4,&process,&length,NULL,0) != 0) return 2;
    if (length == 0) return 1;
    if (length != sizeof process || process.kp_proc.p_pid != pid || process.kp_eproc.e_ucred.cr_ngroups == 0) return 2;
    char executable[PROC_PIDPATHINFO_MAXSIZE];
    int n = proc_pidpath((int)pid, executable, sizeof executable);
    if (n <= 0 || n >= 1536 || executable[0] != '/') return 2;
    for (int i = 0; i < n; i++) {
        if ((unsigned char)executable[i] < 0x20 || (unsigned char)executable[i] > 0x7e) return 2;
    }
    printf("%ld %u %u %s\n",pid,process.kp_eproc.e_ucred.cr_uid,process.kp_eproc.e_ucred.cr_groups[0],executable);
    return 0;
}
