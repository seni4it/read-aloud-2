# 01. Voice server: bounded memory, clean errors, cached files

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

The changes are written in the working tree and have 12 passing tests. Review them, commit them, load them in the live voice server, and check them with the real voice.

The changes: a thread-safe sound cache with a limit of 96 MB and 300 entries; no synthesis for a listener that closed the connection; one book when the same PDF is added twice; error replies that work with non-Latin text; no traceback for a closed connection; a quiet log; validation headers for the reader files; byte ranges for books; escaped text in the sign-in reply page; no leftover sound files after an audio export.

Evidence: server findings in the spec. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] `python -m unittest discover -s tests` passes.
- [ ] After a restart, the live server answers `/voices` with `ready: true` and a sentence plays in the reader.
- [ ] Six skipped sentences then one wanted sentence: the wanted sentence starts in less than 1 second (measured on the test copy: 0.23 s).
- [ ] A second load of the reader gets reply code 304 for the big library files.
- [ ] The log gets no traceback when a listener closes a connection.

## Blocked by

None - can start immediately

## Owner

Owner: the restart stops his reading for some seconds.
