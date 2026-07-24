<!-- written in the style of alibaba/open-code-review rule_docs -->
#### Obvious Typos or Spelling Errors
- Spelling errors in function names, class names, variable names, or dict keys at their declaration sites; do not report at call sites
- Strings in log messages, exceptions, or user-facing text containing spelling errors that affect readability

#### Correctness Gotchas
- Mutable default arguments (`def f(x=[])`, `def f(x={})`) — shared across calls; use `None` sentinel
- `is` / `is not` used for value comparison of strings or numbers instead of `==` (identity works by accident for small ints/interned strings)
- Late-binding closures in loops (`lambda: i` inside `for i in ...`) capturing the final value; bind via default arg
- Mutating a dict/list/set while iterating over it
- Chained comparison misuse or operator precedence surprises (`not x == y` vs `x != y`, `a or b == c`)
- `str.strip("...")` used as substring removal (it strips a character set, not a prefix/suffix); use `removeprefix`/`removesuffix`
- Truthiness pitfalls: `if x:` treating `0`, `""`, `[]` as missing when only `None` should be; use `if x is None`

#### Exception Handling
- Bare `except:` or `except Exception:` that swallows errors (including `KeyboardInterrupt`/`SystemExit` for bare except) without logging or re-raising
- Exceptions caught and converted to `None`/default return values that hide failures from callers
- `raise` inside `except` losing the original traceback; use `raise ... from e` or bare `raise`
- Cleanup done without `finally`/context manager, leaking resources when an exception occurs mid-function

#### Resource and Concurrency
- Files, sockets, subprocesses, or DB connections opened without `with` (or `try/finally` close)
- Blocking calls (`time.sleep`, `requests`, sync file I/O, CPU-heavy work) directly inside `async def` — blocks the event loop; use async equivalents or `run_in_executor`
- Coroutines called without `await` (silently never run) or `asyncio.create_task` results dropped without keeping a reference / handling failures
- Check-then-act races on shared state or file existence (`os.path.exists` then open) instead of EAFP (`try/except FileNotFoundError`)
- Threads sharing mutable state without locks; `threading` used where GIL makes it pointless for CPU-bound work

#### Typing and API Design
- New public functions without type hints when the surrounding codebase uses them
- `dict`/tuples passed around where a `dataclass`/`NamedTuple`/`Enum` would prevent invalid states
- Functions returning inconsistent types across branches (`str` on success, `None` or `False` on failure) without `Optional`/union in the signature

#### Security-Sensitive Code
- `eval()`, `exec()`, or `pickle.load`/`pickle.loads` on untrusted input
- `subprocess` with `shell=True` and interpolated input; build the args list instead
- `yaml.load` without `SafeLoader` (use `yaml.safe_load`)
- SQL built with f-strings/`%`/`+` concatenation instead of parametrized queries
- Path traversal: user-supplied paths joined without validation (`os.path.join(base, user_input)` — absolute paths or `..` escape the base)
- Secrets/tokens logged or hardcoded; `random` used where `secrets` is required (tokens, passwords)
- `requests` calls without `timeout=` in production paths (hangs forever)

#### Performance
- Building strings with `+=` in loops instead of `"".join(...)`
- O(n²) membership tests: `x in list` inside a loop where a `set`/`dict` is the fix
- Reading whole files into memory (`read()`, `readlines()`) where line iteration suffices for large inputs
- N+1 query patterns in ORM code (per-row queries inside a loop instead of a bulk fetch / join)
