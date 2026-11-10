# 06. Speed that keeps the pitch of the voice

GitHub issue: #7
Status: ready-for-human
Type: HITL

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Today the browser plays the sound faster, and that raises the pitch. Make the voice model produce the sound at the asked speed and play it at rate 1. Add the speed to the cache key on the server and in the reader and the add-on. First make a prototype: produce the same sentence at 1.0, 1.1, 1.5, 2.0 and 3.0 and give the owner the files to compare with the present method.

Evidence: audit/reader-ui.md finding 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] The owner hears the comparison files and decides the speeds that use the new method.
- [ ] At a chosen speed the pitch is the same as at speed 1.0.
- [ ] Word highlights are at the correct words at each speed.
- [ ] A speed change does not make the cache grow past its limit.

## Blocked by

- 01 (voice-server-robust)
- 05 (reader-voice-requests)

## Owner

Owner: he listens and decides.

## Work report

10 Nov 2026, prototype only. The script tools/speed-compare.py loads the same Kokoro model (mlx-community/Kokoro-82M-bf16, offline) through the same English pipeline code as voice-server.py, in its own process, with the Python of the LaunchAgent. It did not touch the live server. It says one fixed passage of three sentences with the default voice af_heart at speeds 1.0, 1.1, 1.5, 2.0 and 3.0, trims the edges with the server's own trim(), and writes 15 WAV files and a listening page to ~/read-aloud-samples/speed-compare/ (index.html).

The three methods are: A, the model's own speed parameter; B, today's method (the speed-1.0 sound resampled, so the pitch goes up); C, the speed-1.0 sound stretched with ffmpeg atempo, pitch kept. ffmpeg was found at /opt/homebrew/bin/ffmpeg.

Results. The speed-1.0 passage lasts 15.86 seconds. Methods B and C hit the asked length within 0.2 percent at every speed. Method A gave 15.14 s at 1.1 (5 percent long), 10.35 s at 1.5 (2 percent short), 8.64 s at 2.0 (9 percent long) and 7.29 s at 3.0 (38 percent long). So the model reaches only about 2.2 times at the setting 3.0. No file is silent and no file clips: the peak is 0.27 to 0.33 in all files. Making the sound with the model took 0.67 s at 1.0 and 0.32 s at 3.0, so model speed does not cost time; it is quicker at higher speed because there is less sound to make.

Next step: the owner listens and decides which speeds use which method. If he picks the model method above 2.0, the reader must still play the rest of the speed (for example model 2.0 and a stretch for the rest), because the model alone does not reach 3.0.
