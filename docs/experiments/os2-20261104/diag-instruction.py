#!/usr/bin/env python3
"""OS2 diagnostic: run the unchanged harness with a different Context arm
instruction (plain unchanged). Outside the protocol; for choosing what to build.

    python3 diag-instruction.py plan|execute|assess|analyse ...harness arguments...

The variant is applied in-process before the harness runs, so plan and execute
agree on the prompt and the harness file (and its lock hash) is untouched.
"""
import importlib.util
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('harness', HERE / 'harness.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)

VARIANT = ('Discover source with the z1p-repository tools. Put related searches, explores and packet sources in one '
           'script, not separate calls. Read the implementation and tests you rely on with repository_packet; for TS/JS '
           'prefer mode plan with line anchors, which returns whole enclosing blocks, over wide build ranges.')

if __name__ == '__main__':
    h.INSTRUCTIONS['context'] = VARIANT
    sys.exit(h.main(sys.argv[1:]))
