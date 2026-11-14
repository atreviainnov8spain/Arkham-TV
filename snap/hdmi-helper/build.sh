#!/bin/sh
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
destination=$1
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
umask 022
chmod 0755 "$stage"
install -d "$stage/DEBIAN"
cat > "$stage/DEBIAN/control" <<'CONTROL'
Package: arkham-tv-hdmi
Version: 1.10-1
Architecture: all
Section: video
Priority: optional
Maintainer: Óscar Peña de San Antonio
Depends: python3, snapd, systemd, pkexec
Description: HDMI permission helper for the Arkham TV Snap
 Lets a desktop administrator grant video and audio capture access from Arkham TV.
CONTROL
cat > "$stage/DEBIAN/postinst" <<'POSTINST'
#!/bin/sh
set -e
if [ "$1" = configure ]; then
    deb-systemd-helper enable arkham-tv-hdmi.socket >/dev/null
    if [ -d /run/systemd/system ]; then
        systemctl daemon-reload
        deb-systemd-invoke start arkham-tv-hdmi.socket >/dev/null
    fi
fi
POSTINST
cat > "$stage/DEBIAN/prerm" <<'PRERM'
#!/bin/sh
set -e
if [ "$1" = remove ] && [ -d /run/systemd/system ]; then
    deb-systemd-invoke stop arkham-tv-hdmi.socket >/dev/null
fi
PRERM
cat > "$stage/DEBIAN/postrm" <<'POSTRM'
#!/bin/sh
set -e
if [ "$1" = purge ]; then
    deb-systemd-helper purge arkham-tv-hdmi.socket >/dev/null
fi
if [ -d /run/systemd/system ]; then
    systemctl daemon-reload
fi
POSTRM
chmod 0755 "$stage/DEBIAN/"*rm "$stage/DEBIAN/postinst"
install -Dm644 "$here/authorize.py" "$stage/usr/lib/arkham-tv-hdmi/authorize.py"
for unit in arkham-tv-hdmi.socket arkham-tv-hdmi@.service; do
    install -Dm644 "$here/$unit" "$stage/usr/lib/systemd/system/$unit"
done
install -Dm644 "$here/com.arkhamtv.hdmi.policy" "$stage/usr/share/polkit-1/actions/com.arkhamtv.hdmi.policy"
install -Dm644 "$here/../../LICENSE.md" "$stage/usr/share/doc/arkham-tv-hdmi/copyright"
dpkg-deb --root-owner-group --build "$stage" "$destination"
