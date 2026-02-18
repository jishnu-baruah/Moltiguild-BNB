# GuildRegistry Test Execution Guide

## Quick Start

```bash
# Run all tests
forge test

# Run with verbose output
forge test -vv

# Run with very verbose output (shows stack traces)
forge test -vvv

# Run specific test
forge test --match-test test_RegisterAgent_Success

# Run tests matching pattern
forge test --match-test "test_CompleteMission"
```

## Coverage Analysis

```bash
# Generate coverage report
forge coverage

# Generate detailed coverage report
forge coverage --report summary

# Generate coverage with lcov format
forge coverage --report lcov
```

## Gas Profiling

```bash
# Run tests with gas report
forge test --gas-report

# Save gas snapshot
forge snapshot

# Compare gas usage
forge snapshot --diff
```

## Test Categories

### Run Agent Tests Only
```bash
forge test --match-test "test_RegisterAgent"
```

### Run Mission Tests Only
```bash
forge test --match-test "test_CreateMission|test_CompleteMission"
```

### Run Admin Tests Only
```bash
forge test --match-test "test_WithdrawFees|test_TransferCoordinator"
```

### Run Revert Tests Only
```bash
forge test --match-test "test_RevertWhen"
```

### Run Integration Tests Only
```bash
forge test --match-test "test_Integration"
```

## Debugging Tests

### Run with maximum verbosity
```bash
forge test -vvvv
```

### Run with traces
```bash
forge test --debug test_CompleteMission_Success
```

### Run with gas snapshots
```bash
forge test --gas-report > gas_report.txt
```

## Continuous Integration

### Run all checks
```bash
# Compile
forge build

# Run tests
forge test

# Check coverage
forge coverage --report summary

# Generate gas report
forge test --gas-report

# Check formatting
forge fmt --check
```

## Test Structure

```
test/GuildRegistry.t.sol
├── Setup (setUp function)
│   ├── Deploy contract
│   ├── Create test accounts
│   └── Define events
│
├── Agent Registration Tests (5 tests)
│   ├── Success cases
│   ├── Update scenarios
│   └── Validation tests
│
├── Mission Creation Tests (4 tests)
│   ├── Success cases
│   ├── Multiple missions
│   └── Validation tests
│
├── Mission Completion Tests (11 tests)
│   ├── Success cases
│   ├── Fee handling
│   ├── Edge cases
│   └── Validation tests
│
├── Fee Withdrawal Tests (5 tests)
│   ├── Success cases
│   ├── Multiple sources
│   └── Validation tests
│
├── Coordinator Transfer Tests (4 tests)
│   ├── Success cases
│   ├── Permission tests
│   └── Validation tests
│
├── View Function Tests (3 tests)
│   └── Empty state handling
│
└── Integration Tests (2 tests)
    ├── Full workflow
    └── Agent update workflow
```

## Expected Output

### Successful Test Run
```
Ran 35 tests for test/GuildRegistry.t.sol:GuildRegistryTest
[PASS] test_CompleteMission_ExactBudgetMatch() (gas: 493892)
[PASS] test_CompleteMission_NonRegisteredRecipient() (gas: 339821)
...
[PASS] test_WithdrawFees_Success() (gas: 577659)
Suite result: ok. 35 passed; 0 failed; 0 skipped

Ran 1 test suite: 35 tests passed, 0 failed, 0 skipped
```

### Coverage Report
```
| src/GuildRegistry.sol | 100.00% (69/69) | 100.00% (64/64) | 94.12% (32/34) | 100.00% (11/11) |
```

## Common Issues

### Stack Too Deep Error
If you encounter "stack too deep" errors during coverage:
```bash
forge coverage --ir-minimum
```

### Out of Gas
If tests fail with out of gas:
```bash
# Increase gas limit in foundry.toml
gas_limit = "18446744073709551615"
```

### Compilation Errors
```bash
# Clean build artifacts
forge clean

# Rebuild
forge build
```

## Performance Benchmarks

### Test Execution Time
- **Total Suite**: ~180ms
- **Average per test**: ~5ms
- **Slowest test**: `test_Integration_FullWorkflow` (~1.7M gas)

### Gas Usage Benchmarks
- **registerAgent**: ~134k gas avg
- **createMission**: ~130k gas avg
- **completeMission**: ~131k gas avg (varies with recipients)
- **withdrawFees**: ~42k gas avg
- **transferCoordinator**: ~27k gas avg

## Test Maintenance

### Adding New Tests
1. Follow naming convention: `test_<Function>_<Scenario>`
2. Use `test_RevertWhen_<Condition>` for revert tests
3. Add event expectations with `vm.expectEmit`
4. Include gas assertions for critical paths
5. Update TEST_COVERAGE.md

### Updating Tests
1. Run full suite after changes
2. Verify coverage remains >95%
3. Update gas snapshots if needed
4. Check for new edge cases

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: foundry-rs/foundry-toolchain@v1
      - run: forge test
      - run: forge coverage --report summary
```

## Resources

- [Foundry Book](https://book.getfoundry.sh/)
- [Forge Testing](https://book.getfoundry.sh/forge/tests)
- [Cheatcodes Reference](https://book.getfoundry.sh/cheatcodes/)
- [Coverage Reports](https://book.getfoundry.sh/reference/forge/forge-coverage)
