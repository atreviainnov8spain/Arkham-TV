# Arkham TV

## Store description

Watch and record free-to-air TV on Linux with a compatible USB DVB-T/T2 tuner or USB HDMI capture device. Includes a TV Guide, recordings, teletext, signal analysis and local AI. Available for ARM64 and 64-bit Intel/AMD, with an English or Spanish interface.

**NEW IN 1.12.1 · SOLSTICE IN ARKHAM**

Seasonal Cthulhu details match your colour theme from 20 November through 8 January each year. Static artwork stays in the frame and navigation, outside the video and controls; it adapts to the space available.

**INCLUDED FROM 1.12**

**A new channel universe**
Explore frequencies as planets in a Three.js orbital map. Open the channel inspector, select a channel to tune in and follow the active reception. Data flows, Timeline and Channel anatomy reveal the information carried by the signal.

**Live transcription and recordings**
• Open the AI assistant and choose Start transcription. Opening the panel alone does not start recognition.
• Transcribe saved videos directly from Recordings. Find the results in AI transcripts, clearly marked LIVE or RECORDING.
• Read continuous paragraphs or a script with coloured timestamps in a separate column.
• Export Markdown or plain text, with optional timestamps and AI responses.
• Delete individual saved transcripts or clear the finished panel while keeping its saved session.

**Choose your local AI models**
Download and activate models in Settings when you need them:
• Speech: Whisper in several sizes, plus experimental Parakeet TDT v3 INT8 and Qwen3-ASR 0.6B INT8.
• Chat: Qwen3 and Bonsai 2 in different sizes for questions, summaries, analysis and reports based on your transcripts.
• Recorded voices: optional speaker separation with editable Voice 1, Voice 2 labels. Requires additional models and is off by default; it does not identify people automatically.

Audio, transcripts and questions are processed on your computer. Model downloads require Internet. Pending live audio stays in a local queue while playback has priority. Compatible Intel/AMD CPUs can use AVX2 engines; no dedicated AI graphics card is required.

**TV, RECORDINGS AND MOBILE**

Browse the TV Guide, save favourites and keep tuning profiles for different locations. Record MP4 with AAC stereo and schedule recordings from the guide. Keep Arkham TV open and your computer awake for scheduled recordings. Recording output supports up to 4K; enlarging the output does not add detail to the broadcast.

Adjust audio sync, volume and the ten-band equalizer. Picture and equalizer switches let you bypass processing; Standard displays the captured picture without image filters.

Choose Watch on your phone and scan the QR code with an iPhone or Android on the same Wi-Fi network.

**HDMI AND TUNER COMPATIBILITY**

Connect a TV receiver by HDMI to a USB capture device, such as Elgato Cam Link 4K. Use the receiver's remote to change channels. On a fresh Snap install, open HDMI input, save its permissions helper and install it once through Ubuntu's App Center. Return to the app, check installation and choose Allow.

Linux tuners work when their driver and firmware expose a usable adapter in /dev/dvb. AVerMedia A835 and A835B are supported examples, rather than the only compatible models. DVB-T2 requires a compatible tuner and driver.

**FIRST LAUNCH: ENABLE ANTENNA ACCESS**

Run once before scanning:

    sudo snap connect arkham-tv:dvb

Using Parallels? Assign the tuner USB device to Ubuntu; the guest must detect it before Arkham TV can scan.

**PROJECT AND DOWNLOADS**

https://github.com/atreviainnov8spain/Arkham-TV
Full release history is available in the app's Changelog.

Developed by Óscar Peña de San Antonio. GPL-2.0-or-later.
