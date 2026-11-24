# Clean licences: substitutes and first tests

## Parakeet

- Yes, you can use Parakeet in a paid product. But its licence is not MIT.
- The Parakeet model from NVIDIA has the licence CC BY 4.0. It allows sale and change. You must give credit to NVIDIA, for example on the "About" page.
- The program that runs Parakeet on a Mac, mlx-audio, has the MIT licence. Another program, parakeet-mlx, has the Apache 2.0 licence.
- The Parakeet model was already on your Mac. Version 3 of the model knows 25 European languages, also Italian.

## The list of parts

Parts with a good licence. They stay.

- mlx-audio, the engine for voices and for listening: MIT.
- Kokoro-82M, the natural voices: Apache 2.0.
- misaki, which turns words into sounds for Kokoro: Apache 2.0.
- spaCy and its small English model: MIT.
- Parakeet, which turns speech into text: CC BY 4.0, with credit to NVIDIA.
- pdf.js, the PDF viewer: Apache 2.0.
- The English word list: public domain.

Parts with a bad licence, and the substitutes.

- espeak-ng and phonemizer (GPL 3), for words that misaki does not know. Substitute 1: g2p_en (Apache 2.0). Tested, it works. Substitute 2: deep-phonemizer (MIT) with the OpenPhonemizer model (BSD). Not tested yet, see question 3.
- num2words (LGPL), which reads numbers. Substitute: inflect (MIT), with 40 lines of our own code. Tested, it works.

## Test 1: the voice with no GPL part

I made one test text with hard dental words, numbers and dates. Kokoro read it 3 times, each time with a different helper. Then Parakeet listened to each file and wrote what it heard. This is a full talk-and-listen test.

- With no helper at all: Kokoro skipped 10 of the hard words, for example periapical, radiolucency and chlorhexidine.
- With g2p_en, the clean substitute: Kokoro skipped no word. But many hard words sound wrong. Parakeet heard about 2 of 10 hard words correctly.
- With espeak-ng, the present GPL setup: Parakeet heard about 6 of 10 hard words correctly.
- In all 3 files, the numbers and the dates were correct: 2.5 percent, 17 percent, 1998, 3 May 2024.
- In all 3 files, the unit "mm" after 3.5 was lost. This is a fault in misaki, not in the licence. We can repair it in our own code.
- The check proved that no GPL part was loaded in the clean test.

Result: the clean setup works for normal words. For hard dental words it is worse than the present setup. The repair is our own list of dental words with their sounds (question 2).

## Test 2: Parakeet listens

- Parakeet wrote 33 seconds of speech as text in 0.4 seconds, after the first start of 8 seconds.
- It worked with no internet.
- It runs on Macs with Apple chips. For Windows PCs, the same Parakeet model runs with sherpa-onnx (Apache 2.0).

## Where the tests are

- The folder: `/Volumes/claude/read-aloud/licence-test/`
- The 3 sound files, to hear the difference: `out/tts_none.wav`, `out/tts_g2p_en.wav`, `out/tts_espeak_gpl.wav`.
- Our substitute code: `glue/num2words.py` and `glue/fallbacks.py`.
- The test environment has no GPL part and no LGPL part. Your Read Aloud 2 did not change.

## Questions

### 1. Which computers must the student app run on?

- This question is from round 1.
- Recommended: C.
- (A) Macs only. The present parts work.
- (B) Windows PCs only.
- (C) Macs and Windows PCs. Then I test sherpa-onnx (Apache 2.0), which runs Kokoro and Parakeet on both.

### 2. Shall I make our own list of dental words with their sounds?

- Recommended: yes.
- I start with 300 words from endodontics, radiology and dental materials. I check each word with Parakeet, as in test 1.
- The list is our own work, so you own its licence.

### 3. May I download the OpenPhonemizer model to test substitute 2?

- Recommended: yes.
- The file: `best_model_no_optim.pt`, 73.5 MB, from Hugging Face, project `openphonemizer/ckpt`. Its licence is BSD.
- This file type can hold code that runs when the file opens. I open it only in the safe mode of PyTorch, which loads numbers and no code.
- The safety check of the app stopped this download today. If you say yes, I ask again with your yes.

### 4. Which test app shall I make first?

- Recommended: C.
- (A) A listen app: the student pastes a text and hears it.
- (B) A talk app: the student speaks and sees the text.
- (C) One app with both: the student reads a sentence aloud, sees what Parakeet heard, and hears the correct sentence.
