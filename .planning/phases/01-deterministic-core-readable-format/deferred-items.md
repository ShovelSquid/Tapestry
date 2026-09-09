# Deferred items — Phase 01

Out-of-scope observations logged by executors (scope-boundary rule). None of these block the plan that recorded them.

## From 01-04 (journal suite)

- **`BadEnvelope` offset for a damaged byte count points past the record.** The bit-flip sweep found that flipping a count digit in a commit's head line (e.g. `@commit 2 275` → `@commit 2 375`) makes the decoder look for the `@end` line 100 bytes further on and report `BadEnvelope` at *that* offset, which lies inside the next record. `Codec.hpp` says envelope failures report "the record's own head line", and `DigestMismatch` was moved there in Plan 03, but `codec_test.cpp:400` pins the short-digest `BadEnvelope` at the `@end` position, so the sweep only asserts the lower bound (the bad region never begins before the damaged record). Candidate refinement (Plan 05 or later): report the record's head-line offset for `@end`-position envelope failures too, keeping the `@end` offset in the detail, and update the codec expectation with it.
