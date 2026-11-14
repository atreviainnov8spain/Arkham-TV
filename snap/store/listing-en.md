# Arkham TV

- **Summary** — Watch and record live TV on Linux with a compatible tuner
- **Category** — Photo and Video
- **License** — GPL-2.0-or-later

## Store description

Watch and record free-to-air television on Linux with a compatible USB DVB-T or DVB-T2 tuner, or a USB HDMI capture device. Available for ARM64 and 64-bit Intel/AMD.

**New in 1.10 · HDMI and picture controls**

Open **HDMI input** to watch an external TV receiver. In **Live**, choose a picture mode or save personal settings for brightness, contrast, sharpness and colour. HDMI recording supports up to 1080p with stereo sound.

On a fresh install, open **HDMI input** to save the HDMI permissions helper and install it once in Ubuntu's App Center. Return to Arkham TV, check the installation and choose **Allow**. Ubuntu asks an administrator to approve camera and audio access.

**New in 1.9 · Invisible TV**

Explore scanned frequencies as planets in a 3D universe. The antenna sits at the centre, and each planet’s satellites are the channels that share its frequency. Select a planet to zoom in, then select a channel to tune in.

Follow the active signal through animated electric pulses with red and blue edges. **Data flows** shows how much data goes to video, audio, subtitles and teletext. **Timeline** shows recent reception changes, and **Channel anatomy** lists the tracks carried by the channel.

**New in 1.9 · Teletext over the air**

Open **Teletext** to load the broadcaster’s index automatically as pages arrive. Choose a channel or enter a page number to jump straight to it.

Use **Reading** for clearer headlines, columns and links, or **Original view** for the broadcast grid, colours and mosaics. Pages stay in the broadcaster’s language.

**Live TV, recordings and mobile**

Watch live, browse the TV Guide and save channel lists for different locations. Adjust audio sync per channel and use the ten-band equalizer.

Record to MP4 with AAC stereo at up to 4K. Schedule recordings from the TV Guide and keep the app open and your computer awake.

Select **Watch on your phone** and scan the QR code with an iPhone or Android on the same Wi-Fi network. Rotate the phone to fill the screen and change channels from its TV Guide.

**Tuner compatibility**

Arkham TV was created to keep the **AVerMedia AVerTV Volar HD USB A835** (Afatech AF9035) and **A835B** (ITE IT9135 family) in use.

Other DVB-T and DVB-T2 tuners work when Ubuntu exposes them in `/dev/dvb` with a working driver and firmware. Scans cover UHF 21–48 (8 MHz). Playback codecs are included for ARM64 and 64-bit Intel/AMD.

**First launch · Enable tuner access**

Open **Terminal** and run this command once before scanning. Automatic DVB access is awaiting Canonical approval.

    sudo snap connect arkham-tv:dvb

The interface and Changelog are available in English and Spanish. Developed by Óscar Peña de San Antonio, 2026.

**Recent changes**

**1.9 · Invisible TV and Teletext**

Explore the 3D signal map, see reception and bitrate measurements, and inspect each channel’s tracks.

Read teletext pages over the air with clearer columns, accents and page links, or switch to the original grid.

Collapse the sidebar for more space, and find channels by frequency in both views. The app includes its own monospaced font for consistent page numbers and tables.

**1.8.24 · Live TV on iPhone and Android**

Pair over Wi-Fi with a QR code, watch in landscape and change channels from the mobile TV Guide.

**1.8.23 · More tuners on Ubuntu**

Adds support for DVB-T and DVB-T2 tuners that Ubuntu recognises.

**1.8.22 · Recording and playback**

Improves 4K recording stability and plays saved recordings within the app.

Open **Changelog** in Arkham TV for the full release history.
