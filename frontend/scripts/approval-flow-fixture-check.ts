/**
 * Approval-flow fixture check.
 *
 * Tests every rejection path in the explicit wallet approval flow:
 *   - Wallet rejection (user clicks reject in wallet)
 *   - Frontend UI Reject button
 *   - Wallet mismatch (wrong connected address)
 *   - Network mismatch (wrong connected network)
 *   - Expired plan (10 min TTL exceeded)
 *   - Unsafe action (avoid / manual_review / no_action)
 *
 * Run: tsx --tsconfig tsconfig.json scripts/approval-flow-fixture-check.ts
 */
import { validateApproval } from "../src/server/transactions/approvalFlow";
import { recordUserRejection } from "../src/server/transactions/lifecycleManager";
import {
  createTransactionRecord,
  getTransactionRecord,
  isImmutableTerminal,
  listTransactionLifecycleEvents,
  removeTransactionRecordByHash,
} from "../src/server/storage";
import type { TransactionRecord } from "../src/server/types";

// ── Helpers ────────────────────────────────────────────────────────────────

let failureCount = 0;
let testCount = 0;

function assert(condition: unknown, message: string): asserts condition {
  testCount++;
  if (!condition) {
    failureCount++;
    console.error(`  FAIL: ${message}`);
  } else {
    console.log(`  PASS: ${message}`);
  }
}

function assertRejectionResult(
  result: { allowed: boolean; blockedReason?: string; walletOk: boolean; networkOk: boolean; expired: boolean; actionSafe: boolean },
  expected: { allowed: false; walletOk: boolean; networkOk: boolean; expired: boolean; actionSafe: boolean },
  scenario: string,
) {
  assert(!result.allowed, `${scenario}: must not be allowed`);
  assert(result.walletOk === expected.walletOk, `${scenario}: walletOk must be ${expected.walletOk}, got ${result.walletOk}`);
  assert(result.networkOk === expected.networkOk, `${scenario}: networkOk must be ${expected.networkOk}, got ${result.networkOk}`);
  assert(result.expired === expected.expired, `${scenario}: expired must be ${expected.expired}, got ${result.expired}`);
  assert(result.actionSafe === expected.actionSafe, `${scenario}: actionSafe must be ${expected.actionSafe}, got ${result.actionSafe}`);
  assert(typeof result.blockedReason === "string" && result.blockedReason.length > 0, `${scenario}: must include a blockedReason`);
}

function makeEVMTransactionRecord(hash: string, overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  const now = new Date();
  return createTransactionRecord({
    hash,
    type: "swap",
    asset: "MEME",
    valueUsd: 100,
    status: "prepared",
    chainFamily: "evm",
    network: "base",
    walletAddress: "0xabc123def456abc123def456abc123def456abc1",
    sourceAccount: "0xabc123def456abc123def456abc123def456abc1",
    decisionId: "decision_test",
    decisionAction: "reduce_exposure",
    userApproved: true,
    simulationStatus: "passed",
    policyStatus: { allowed: true, violations: [] },
    expectedEffects: [
      {
        kind: "swap",
        fromToken: "0x9999999999999999999999999999999999999999",
        toToken: "USDC",
        fromAddress: "0xabc123def456abc123def456abc123def456abc1",
        amount: "50.00",
        contractAddress: "0x9999999999999999999999999999999999999999",
        assetKey: "MEME",
      },
    ],
    idempotencyKey: `idem_${hash}`,
    createdAt: now.toISOString(),
    ...overrides,
  });
}

function makeStellarTransactionRecord(hash: string, overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  const now = new Date();
  return createTransactionRecord({
    hash,
    type: "swap",
    asset: "MEME",
    valueUsd: 100,
    status: "prepared",
    chainFamily: "stellar",
    network: "stellar-testnet",
    walletAddress: "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
    sourceAccount: "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
    decisionId: "decision_stellar_test",
    decisionAction: "reduce_exposure",
    userApproved: true,
    simulationStatus: "passed",
    policyStatus: { allowed: true, violations: [] },
    expectedEffects: [
      {
        kind: "swap",
        fromToken: "MEME",
        toToken: "USDC",
        fromAddress: "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q",
        amount: "50.00",
        contractAddress: "CDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5",
        assetKey: "MEME",
      },
    ],
    idempotencyKey: `idem_stellar_${hash}`,
    createdAt: now.toISOString(),
    ...overrides,
  });
}

// ── Cleanup ────────────────────────────────────────────────────────────────

function cleanRecords(...hashes: string[]) {
  for (const h of hashes) {
    try { removeTransactionRecordByHash(h); } catch { /* best-effort */ }
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function runApprovalFlowFixtures() {
  console.log("\n=== Approval Flow Rejection-Path Fixtures ===\n");

  // ----- 1. EVM: Wallet rejection via recordUserRejection -----
  console.log("\n── 1. EVM wallet rejection (recordUserRejection) ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    makeEVMTransactionRecord(hash);

    try {
      const rejected = await recordUserRejection(hash, {
        walletAddress: wallet,
        reason: "User rejected in wallet.",
        source: "wallet",
      });
      assert(rejected.lifecycleStatus === "user_rejected", "recordUserRejection must set lifecycleStatus to user_rejected");
      assert(rejected.status === "user_rejected", "recordUserRejection must set status to user_rejected");
      assert(rejected.terminalAt !== undefined, "recordUserRejection must set terminalAt");
      assert(rejected.failureReason === "User rejected in wallet.", "recordUserRejection must set failureReason");
      assert(isImmutableTerminal("user_rejected"), "user_rejected must be an immutable terminal state");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 2. Stellar: Wallet rejection via recordUserRejection -----
  console.log("\n── 2. Stellar wallet rejection (recordUserRejection) ──\n");
  {
    const hash = "0000000000000000000000000000000000000000000000000000000000000001";
    const wallet = "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    makeStellarTransactionRecord(hash);

    try {
      const rejected = await recordUserRejection(hash, {
        walletAddress: wallet,
        reason: "User rejected in wallet.",
        source: "wallet",
      });
      assert(rejected.lifecycleStatus === "user_rejected", "Stellar recordUserRejection must set lifecycleStatus to user_rejected");
      assert(rejected.failureReason === "User rejected in wallet.", "Stellar recordUserRejection must set failureReason");
      assert(isImmutableTerminal("user_rejected"), "Stellar user_rejected must be a terminal state");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 3. Frontend UI Reject button (via handleReject pattern) -----
  console.log("\n── 3. Frontend UI rejection ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000002";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    makeEVMTransactionRecord(hash);

    try {
      const rejected = await recordUserRejection(hash, {
        walletAddress: wallet,
        reason: "User rejected in the frontend UI.",
        source: "frontend",
      });
      assert(rejected.lifecycleStatus === "user_rejected", "Frontend rejection must set lifecycleStatus to user_rejected");
      assert(rejected.failureReason === "User rejected in the frontend UI.", "Frontend rejection must set frontend-specific reason");
      const events = listTransactionLifecycleEvents(hash);
      assert(events.some((e) => e.event === "user_rejected"), "Frontend rejection must append a user_rejected lifecycle event");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 4. Wallet mismatch -----
  console.log("\n── 4. Wallet mismatch ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000003";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const wrongWallet = "0xffffffffffffffffffffffffffffffffffffffff";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash);

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wrongWallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: false,
        networkOk: true,
        expired: false,
        actionSafe: true,
      }, "Wallet mismatch");
      assert(result.blockedReason?.includes(wrongWallet), "Wallet mismatch must mention the wrong wallet address");
      assert(result.blockedReason?.includes(wallet), "Wallet mismatch must mention the expected wallet address");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 5. Network mismatch -----
  console.log("\n── 5. Network mismatch ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000004";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash);

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "arbitrum",  // different network
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: false,
        expired: false,
        actionSafe: true,
      }, "Network mismatch");
      assert(result.blockedReason?.includes("arbitrum"), "Network mismatch must mention connected network");
      assert(result.blockedReason?.includes("base"), "Network mismatch must mention expected network");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 6. Stellar network mismatch -----
  console.log("\n── 6. Stellar network mismatch ──\n");
  {
    const hash = "0000000000000000000000000000000000000000000000000000000000000002";
    const wallet = "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    const idempotencyKey = `idem_stellar_${hash}`;
    makeStellarTransactionRecord(hash);

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "stellar", network: "stellar-testnet" },
        wallet,
        "stellar-pubnet",  // different network
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: false,
        expired: false,
        actionSafe: true,
      }, "Stellar network mismatch");
      assert(result.blockedReason?.toLowerCase().includes("stellar-pubnet"), "Stellar network mismatch must mention connected network");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 7. Expired plan (old createdAt) -----
  console.log("\n── 7. Expired plan ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000005";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    // Create a record that is 15 minutes old (TTL is 10 min)
    const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    makeEVMTransactionRecord(hash, { createdAt: fifteenMinAgo });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: true,
        actionSafe: true,
      }, "Expired plan");
      assert(result.blockedReason?.toLowerCase().includes("expired"), "Expired plan must mention expiration");

      // Verify the record was marked as expired in storage
      const record = getTransactionRecord(hash);
      assert(record?.lifecycleStatus === "expired", "Expired plan must update lifecycle to expired");
      assert(record?.terminalAt !== undefined, "Expired plan must set terminalAt");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 8. Unsafe action: avoid -----
  console.log("\n── 8. Unsafe action (avoid) ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000006";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash, { decisionAction: "avoid" });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      }, "Unsafe action (avoid)");
      assert(result.blockedReason?.toLowerCase().includes("avoid"), "Unsafe action must mention 'avoid'");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 9. Unsafe action: manual_review -----
  console.log("\n── 9. Unsafe action (manual_review) ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000007";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash, { decisionAction: "manual_review" });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      }, "Unsafe action (manual_review)");
      assert(result.blockedReason?.toLowerCase().includes("manual_review"), "Unsafe action must mention 'manual_review'");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 10. Unsafe action: no_action -----
  console.log("\n── 10. Unsafe action (no_action) ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000008";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash, { decisionAction: "no_action" });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      }, "Unsafe action (no_action)");
      assert(result.blockedReason?.toLowerCase().includes("no_action"), "Unsafe action must mention 'no_action'");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 11. Missing connected wallet -----
  console.log("\n── 11. Missing connected wallet ──\n");
  {
    const hash = "0x0000000000000000000000000000000000000000000000000000000000000009";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash);

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        undefined,  // no connected wallet
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: false,
        networkOk: false,
        expired: false,
        actionSafe: true,
      }, "Missing connected wallet");
      assert(result.blockedReason?.toLowerCase().includes("connected wallet address is required"), "Missing wallet must mention requirement");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 12. Missing connected network -----
  console.log("\n── 12. Missing connected network ──\n");
  {
    const hash = "0x000000000000000000000000000000000000000000000000000000000000000a";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash);

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        undefined,  // no connected network
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: false,
        expired: false,
        actionSafe: true,
      }, "Missing connected network");
      assert(result.blockedReason?.toLowerCase().includes("connected network is required"), "Missing network must mention requirement");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 13. No prepared transaction (wrong idempotency key) -----
  console.log("\n── 13. No prepared transaction ──\n");
  {
    const result = await validateApproval(
      { idempotencyKey: "nonexistent_key_12345", walletAddress: "0xabc123def456abc123def456abc123def456abc1", chainFamily: "evm", network: "base" },
      "0xabc123def456abc123def456abc123def456abc1",
      "base",
    );
    assertRejectionResult(result, {
      allowed: false,
      walletOk: true,
      networkOk: true,
      expired: false,
      actionSafe: true,
    }, "No prepared transaction");
    assert(result.blockedReason?.toLowerCase().includes("no prepared transaction"), "No record must mention missing prepared transaction");
  }

  // ----- 14. Terminal state record cannot be re-approved -----
  console.log("\n── 14. Terminal state cannot be re-approved ──\n");
  {
    const hash = "0x000000000000000000000000000000000000000000000000000000000000000b";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    // Create a record that's already confirmed (terminal)
    makeEVMTransactionRecord(hash, { lifecycleStatus: "confirmed", status: "confirmed", terminalAt: new Date().toISOString() });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: true,
      }, "Terminal state cannot be re-approved");
      assert(result.blockedReason?.toLowerCase().includes("terminal state"), "Terminal block must mention 'terminal state'");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 15. Stellar wallet mismatch -----
  console.log("\n── 15. Stellar wallet mismatch ──\n");
  {
    const hash = "0000000000000000000000000000000000000000000000000000000000000003";
    const wallet = "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    const wrongWallet = "GAXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6R";
    const idempotencyKey = `idem_stellar_${hash}`;
    makeStellarTransactionRecord(hash);

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "stellar", network: "stellar-testnet" },
        wrongWallet,
        "stellar-testnet",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: false,
        networkOk: true,
        expired: false,
        actionSafe: true,
      }, "Stellar wallet mismatch");
      assert(result.blockedReason?.toLowerCase().includes(wrongWallet.toLowerCase().slice(0, 8)), "Stellar wallet mismatch must mention wrong wallet");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 16. Metadata-only swap blocked (no real calldata) -----
  console.log("\n── 16. Metadata-only swap blocked (no calldata) ──\n");
  {
    const hash = "0x000000000000000000000000000000000000000000000000000000000000000c";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    // Create a swap-action record WITHOUT calldata (metadata-only)
    // makeEVMTransactionRecord defaults to no calldata, which triggers the guard
    makeEVMTransactionRecord(hash, { decisionAction: "swap" });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      }, "Metadata-only swap blocked");
      assert(result.blockedReason?.toLowerCase().includes("metadata-only"), "Metadata-only swap must mention 'metadata-only'");
      assert(result.blockedReason?.toLowerCase().includes("swap"), "Metadata-only swap must mention 'swap' action");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 17. Metadata-only Stellar swap blocked (no XDR) -----
  console.log("\n── 17. Metadata-only Stellar swap blocked (no XDR) ──\n");
  {
    const hash = "0000000000000000000000000000000000000000000000000000000000000004";
    const wallet = "GDXHOKE7W6FZ6N5K4J7H3E5F2G8A9B1C2D4E5F6G7H8I9J0K1L2M3N4O5P6Q";
    const idempotencyKey = `idem_stellar_${hash}`;
    // Create a Stellar swap-action record WITHOUT XDR (metadata-only)
    makeStellarTransactionRecord(hash, { decisionAction: "swap" });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "stellar", network: "stellar-testnet" },
        wallet,
        "stellar-testnet",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      }, "Metadata-only Stellar swap blocked");
      assert(result.blockedReason?.toLowerCase().includes("metadata-only"), "Metadata-only Stellar swap must mention 'metadata-only'");
    } finally {
      cleanRecords(hash);
    }
  }

  // ----- 18. Metadata-only reduce_exposure blocked (no calldata) -----
  console.log("\n── 18. Metadata-only reduce_exposure blocked (no calldata) ──\n");
  {
    const hash = "0x000000000000000000000000000000000000000000000000000000000000000d";
    const wallet = "0xabc123def456abc123def456abc123def456abc1";
    const idempotencyKey = `idem_${hash}`;
    makeEVMTransactionRecord(hash, { decisionAction: "reduce_exposure" });

    try {
      const result = await validateApproval(
        { idempotencyKey, walletAddress: wallet, chainFamily: "evm", network: "base" },
        wallet,
        "base",
      );
      assertRejectionResult(result, {
        allowed: false,
        walletOk: true,
        networkOk: true,
        expired: false,
        actionSafe: false,
      }, "Metadata-only reduce_exposure blocked");
      assert(result.blockedReason?.toLowerCase().includes("metadata-only"), "Metadata-only reduce_exposure must mention metadata-only");
    } finally {
      cleanRecords(hash);
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n── Results ──\n`);
  if (failureCount === 0) {
    console.log(`✓ All ${testCount} approval-flow rejection-path fixtures passed.\n`);
  } else {
    console.error(`✗ ${failureCount} of ${testCount} approval-flow rejection-path fixtures failed.\n`);
    process.exitCode = 1;
  }

  return { tests: testCount, failures: failureCount };
}

// ── Main ───────────────────────────────────────────────────────────────────

runApprovalFlowFixtures().catch((error) => {
  console.error("Fatal error in approval-flow fixtures:", error);
  process.exitCode = 1;
});
