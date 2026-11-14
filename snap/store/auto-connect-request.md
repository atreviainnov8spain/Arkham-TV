# Auto-connect DVB and hardware-observe for Arkham TV

- **Name** — `arkham-tv`
- **Description** — Arkham TV is a strictly confined desktop app for tuning, watching and recording terrestrial DVB-T with an AVerMedia AVerTV Volar A835 or A835B.
- **Snap Store** — https://snapcraft.io/arkham-tv
- **Snap ID** — `anWVQip52Xh0KM5SuQts3pkOy7do3MIc`
- **Source** — https://github.com/atreviainnov8spain/Arkham-TV
- **Upstream relation** — I am the developer and publisher.

**Plugs**

- **`dvb`**

  **Request type** — Auto-connection.

  **Reason** — Tuning, live playback and recording use the Linux DVB frontend, demux and DVR nodes under `/dev/dvb`. The app opens only the adapter that matches a supported tuner.
- **`hardware-observe`**

  **Request type** — Auto-connection.

  **Reason** — The app reads USB vendor and product IDs in sysfs to match the DVB frontend to one of the supported A835 or A835B variants. It also uses those IDs to distinguish an unplugged tuner from one that is waiting for the DVB driver. The app reads this information locally.

Version 1.8.22 is in `latest/stable` for AMD64 (revision 14) and ARM64 (revision 15). On a fresh installation of revision 15 from the Store, Ubuntu detected the A835 over USB and both plugs were disconnected. With both plugs connected, the confined snap found 35 DVB-T channels and played a live broadcast. Please enable auto-connection for these two plugs so a supported tuner works on first launch.
