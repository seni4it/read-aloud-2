# Can the reader become a product for students?

Short answer: yes, mostly. You can give it free, or sell it as a subscription on your website. MIT and Apache 2.0 both allow this. But some parts need a change first.

This is not legal advice. Before you sell, let a lawyer check the final list and your subscription terms.

## What MIT allows

- MIT allows you to use, change, copy and sell the code. A subscription is allowed.
- You must keep the copyright line and the MIT licence text with every copy that you give out.
- The code comes with no warranty. Your own terms must say the same.

## What Apache 2.0 allows

- Apache 2.0 allows the same things as MIT.
- You must also keep its NOTICE file, and mark the files that you changed.
- It also gives you a patent licence from the authors.

## The parts that you use now

I did not find a part with the name "Sparkit" on this Mac. I think that you mean mlx-audio, the MIT part that runs the voices. Question 1 asks this.

- mlx-audio, the voice engine: MIT. You can sell it.
- Kokoro-82M, the natural voices: Apache 2.0. You can sell it.
- misaki, which turns words into sounds for Kokoro: Apache 2.0. You can sell it.
- spaCy, the English grammar tool: MIT. You can sell it.
- pdf.js from Mozilla, the PDF viewer: Apache 2.0. You can sell it.
- The English word list: public domain. You can sell it.
- Paper Reader and the Read Aloud 2 add-on: your own work. You decide.

## The parts with a problem

- espeak-ng and phonemizer: GPL 3. Kokoro uses them for words that are not in its dictionary. GPL 3 lets you sell, but then you must give the full source code of the whole app, under GPL 3. Anyone can then share your app for free. This kills a paid product.
- num2words, which reads numbers aloud: LGPL. You can use it in a paid app, if users can replace it. This is easy in Python. Keep it as a separate file.
- The Mac voices and Apple Vision, which reads text in pictures: they are part of macOS. Your app can use them on a Mac. You cannot copy them, and they do not exist on Windows.
- mlx-audio works only on Macs with Apple chips (M1 and later). On Windows PCs, the same Kokoro voices must run with another engine, for example kokoro-onnx (MIT) or sherpa-onnx (Apache 2.0).
- Claude: if the student app talks with Claude, you need an Anthropic API account and you pay for each use. You cannot resell Claude Code or your own Claude plan.

## Other things for a paid product

- Do not use the name Speechify, or other brand names, in your product or in your advertising.
- Students in the EU: if the app sends voice or text to a server, you need a privacy policy under the GDPR. If all runs on the student's own computer, this is much easier.
- Put one file "THIRD-PARTY" in the app with every licence text. Your project already has the start of this file.

## Questions

### 1. Which part did you mean by "Sparkit"?

- Recommended: A.
- (A) mlx-audio, the voice engine (MIT).
- (B) A speech-to-text tool, so that students can talk. Tell me its name in the comment.
- (C) Another part. Tell me its name in the comment.

### 2. Shall I replace the GPL parts, espeak-ng and phonemizer?

- Recommended: yes.
- Reason: with them, a paid app must give its full source code to everyone.
- Kokoro can run without them, with its own dictionary only. Rare words then sound less good. I can test how many words of your texts this changes.

### 3. Which computers must the student app run on?

- Recommended: C.
- (A) Macs only. The present parts work.
- (B) Windows PCs only.
- (C) Macs and Windows PCs. Then I look for one engine that works on both, for example sherpa-onnx (Apache 2.0).

### 4. Shall I make a full licence check of the product, part by part, before you sell?

- Recommended: yes.
- I make one list of every part, its licence and what you must do. You give this list to your lawyer.
