"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, ArrowRight, BrainCircuit, Check, ChevronDown, CircleHelp, Loader2, Search, Wallet, X } from "lucide-react";
import type { AgentResult, PortfolioSnapshot, TokenHolding, TokenScanResult } from "@/server/types";
import { AgentResultPanel } from "@/components/AgentResultPanel";
import { NoDataState } from "@/components/NoDataState";
import { RiskScoreCard } from "@/components/RiskScoreCard";
import { WalletPortfolioCard } from "@/components/WalletPortfolioCard";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import { getScanNetwork, normalizeScanNetworkId, scanNetworks } from "@/lib/scanNetworks";
import { useWalletSession } from "@/hooks/useWalletSession";
import { ApprovalFlowClient } from "@/components/ApprovalFlowClient";
import { StellarRiskPublishButton } from "@/components/StellarRiskPublishButton";

const scanCheckLabels = ["Deployed", "Honeypot", "Sell tax", "Ownership", "Holders", "Liquidity", "LP lock", "Market"];

function getNetworkLabel(value?: string) {
  return getScanNetwork(value)?.name ?? (value || "Unknown");
}

function getScanCheckTone(status: NonNullable<TokenScanResult["analysisChecks"]>[number]["status"]) {
  if (status === "pass") return "border-emerald-300/25 bg-emerald-300/8 text-emerald-200";
  if (status === "warning") return "border-[#d9a441]/30 bg-[#d9a441]/8 text-[#f2c86d]";
  if (status === "danger") return "border-red-300/30 bg-red-400/8 text-red-200";
  return "border-white/10 bg-white/[.035] text-white/38";
}

function getScanCheckMark(status: NonNullable<TokenScanResult["analysisChecks"]>[number]["status"]) {
  if (status === "pass") return "+";
  if (status === "warning") return "!";
  if (status === "danger") return "x";
  return "?";
}

type DashboardAgentKey = "portfolio" | "onchain" | "news" | "social" | "decision";
type DashboardStepStatus = "idle" | "running" | "complete" | "skipped" | "error";

type DashboardRunStep = {
  key: DashboardAgentKey;
  label: string;
  detail: string;
  status: DashboardStepStatus;
};

type DashboardRunSummary = {
  riskyToken?: Pick<TokenHolding, "symbol" | "name" | "tokenAddress" | "chainId" | "chainName" | "riskScore" | "allocationPercent">;
  final?: AgentResult;
  error?: string;
  recordId?: string;
  saveStatus?: "idle" | "saving" | "saved" | "error";
};

const dashboardStepTemplates: Omit<DashboardRunStep, "status">[] = [
  { key: "portfolio", label: "Portfolio", detail: "Wallet exposure" },
  { key: "onchain", label: "Onchain", detail: "Contract and liquidity" },
  { key: "news", label: "News", detail: "Market catalysts" },
  { key: "social", label: "Social", detail: "Hype quality" },
  { key: "decision", label: "Decision", detail: "Final action" },
];

function getInitialDashboardSteps(): DashboardRunStep[] {
  return dashboardStepTemplates.map((step) => ({ ...step, status: "idle" }));
}

function WalletRequiredState() {
  return (
    <section className="flex min-h-[430px] items-center justify-center rounded-[24px] border border-[#d9a441]/20 bg-[radial-gradient(circle_at_center,rgba(217,164,65,.10),transparent_62%)] px-6 py-16 text-center">
      <div className="flex max-w-md flex-col items-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full border border-[#d9a441]/15" />
          <div className="absolute inset-3 animate-pulse rounded-full border border-[#d9a441]/30 bg-[#d9a441]/5" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-[#d9a441]/35 bg-black/60 shadow-[0_0_45px_rgba(217,164,65,.18)]">
            <Wallet className="h-7 w-7 text-[#d9a441]" />
          </div>
        </div>
        <div className="mt-5 text-xs font-semibold uppercase tracking-[0.22em] text-[#d9a441]">Wallet required</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Connect your wallet</h1>
        <p className="mt-3 text-sm leading-6 text-white/48">Connect your wallet to view your portfolio and run personalized agent analysis.</p>
        <div className="mt-7">
          <WalletConnectButton />
        </div>
      </div>
    </section>
  );
}

function PortfolioLoadingState() {
  return (
    <section className="flex min-h-[430px] items-center justify-center px-6 py-16 text-center">
      <div className="flex flex-col items-center">
        <div className="relative flex h-20 w-20 items-center justify-center">
          <div className="absolute inset-0 animate-ping rounded-full border border-[#d9a441]/15" />
          <div className="absolute inset-2 animate-pulse rounded-full border border-[#d9a441]/30" />
          <Loader2 className="h-7 w-7 animate-spin text-[#d9a441]" />
        </div>
        <div className="mt-5 text-lg font-semibold text-white">Loading your portfolio</div>
        <div className="mt-2 text-sm text-white/42">Reading connected wallet balances and risk signals.</div>
      </div>
    </section>
  );
}

function isEvmAddress(value?: string) {
  return Boolean(value?.trim().match(/^0x[a-fA-F0-9]{40}$/));
}

function getRiskiestHolding(holdings: TokenHolding[]) {
  return [...holdings].sort((left, right) => {
    const riskGap = right.riskScore - left.riskScore;

    return riskGap !== 0 ? riskGap : right.allocationPercent - left.allocationPercent;
  })[0];
}

function getStepTone(status: DashboardStepStatus) {
  if (status === "complete") return "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  if (status === "running") return "border-[#d9a441]/35 bg-[#d9a441]/10 text-[#f2c86d]";
  if (status === "error") return "border-red-300/25 bg-red-300/10 text-red-200";
  if (status === "skipped") return "border-white/10 bg-white/5 text-white/38";

  return "border-white/10 bg-black/20 text-white/52";
}

function getPortfolioRiskDrivers(portfolio: PortfolioSnapshot) {
  const topHoldings = [...portfolio.holdings].sort((left, right) => right.riskScore - left.riskScore).slice(0, 3);
  const largestHolding = [...portfolio.holdings].sort((left, right) => right.allocationPercent - left.allocationPercent)[0];
  const stableReserve = portfolio.holdings
    .filter((holding) => ["USDC", "USDT", "DAI"].includes(holding.symbol.toUpperCase()))
    .reduce((total, holding) => total + holding.allocationPercent, 0);
  const liquidityExitRisk = portfolio.holdings
    .filter((holding) => holding.signals.liquidityRisk >= 70)
    .reduce((total, holding) => total + holding.allocationPercent, 0);

  return {
    topHoldings,
    largestHolding,
    stableReserve,
    liquidityExitRisk,
    suggestedRebalance:
      portfolio.riskScore >= 70
        ? "Reduce high-risk exposure and increase stable reserve."
        : stableReserve < 10
          ? "Increase stable reserve before taking more token risk."
          : "Monitor current allocation; no urgent rebalance signal.",
  };
}

async function postAgentResult(endpoint: string, body: unknown): Promise<AgentResult> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${endpoint} failed with ${response.status}`);
  }

  return (await response.json()) as AgentResult;
}

export function DashboardClient() {
  const { address, isConnected, isConnecting, family, chain } = useWalletSession();
  const [portfolioRequest, setPortfolioRequest] = useState<{
    address: string;
    status: "ready" | "error";
    data?: PortfolioSnapshot;
  } | null>(null);
  const [scanQuery, setScanQuery] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState(scanNetworks[0]);
  const [isNetworkOpen, setIsNetworkOpen] = useState(false);
  const [networkSearch, setNetworkSearch] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [scanStageIndex, setScanStageIndex] = useState(0);
  const [visibleScanChecks, setVisibleScanChecks] = useState(0);
  const [isScoreReasonOpen, setIsScoreReasonOpen] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<TokenScanResult | null>(null);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const scanStageIndexRef = useRef(0);
  const scanInFlightRef = useRef(false);
  const [isDashboardRunOpen, setIsDashboardRunOpen] = useState(false);
  const [approvalFlowOpen, setApprovalFlowOpen] = useState(false);
  const [approvalPrepareData, setApprovalPrepareData] = useState<{
    idempotencyKey: string;
    chainFamily: "evm" | "stellar";
    network: string;
    walletAddress: string;
    sourceAccount?: string;
  } | null>(null);
  const [isRunningAgents, setIsRunningAgents] = useState(false);
  const [dashboardRunSteps, setDashboardRunSteps] = useState<DashboardRunStep[]>(getInitialDashboardSteps);
  const [dashboardAgentResults, setDashboardAgentResults] = useState<AgentResult[]>([]);
  const [dashboardRunSummary, setDashboardRunSummary] = useState<DashboardRunSummary | null>(null);
  const normalizedAccountAddress = address?.toLowerCase();
  const portfolioRequestMatches = Boolean(normalizedAccountAddress && portfolioRequest?.address === normalizedAccountAddress);
  const portfolio = portfolioRequestMatches && portfolioRequest?.status === "ready" ? portfolioRequest.data ?? null : null;
  const portfolioFailed = portfolioRequestMatches && portfolioRequest?.status === "error";

  useEffect(() => {
    if (!isConnected || !address) return;

    const controller = new AbortController();
    const requestAddress = address.toLowerCase();

    const params = new URLSearchParams({ walletAddress: address });
    if (family === "stellar" && chain) params.set("chain", chain);

    fetch(`/api/portfolio?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Portfolio request failed with ${response.status}`);
        return response.json() as Promise<PortfolioSnapshot>;
      })
      .then((data) => {
        setPortfolioRequest({ address: requestAddress, status: "ready", data });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setPortfolioRequest({ address: requestAddress, status: "error" });
      });

    return () => controller.abort();
  }, [address, chain, family, isConnected]);

  useEffect(() => {
    if (!isScanning) return;

    const timer = window.setInterval(() => {
      setScanStageIndex((current) => {
        const next = current >= scanCheckLabels.length - 1 ? current : current + 1;
        scanStageIndexRef.current = next;

        return next;
      });
    }, 700);

    return () => window.clearInterval(timer);
  }, [isScanning]);

  useEffect(() => {
    const checkCount = scanResult?.analysisChecks?.length ?? 0;

    if (checkCount === 0 || visibleScanChecks >= checkCount) return;

    const timer = window.setTimeout(() => setVisibleScanChecks((current) => current + 1), 420);

    return () => window.clearTimeout(timer);
  }, [scanResult, visibleScanChecks]);

  if (!isConnected && !isConnecting) {
    return <WalletRequiredState />;
  }

  if (isConnecting || isConnected && !portfolio && !portfolioFailed) {
    return <PortfolioLoadingState />;
  }

  if (!portfolio || portfolioFailed) {
    return <NoDataState title="Provider unavailable" detail="Portfolio source has not returned a wallet snapshot yet." action="Not enough connected sources. No mock data used." />;
  }

  const riskDrivers = getPortfolioRiskDrivers(portfolio);
  const normalizedNetworkSearch = networkSearch.trim().toLowerCase();
  const filteredNetworks = normalizedNetworkSearch
    ? scanNetworks.filter((network) => `${network.name} ${network.id}`.toLowerCase().includes(normalizedNetworkSearch))
    : scanNetworks;
  const scanChecks = scanResult?.analysisChecks ?? [];
  const scanRevealComplete = Boolean(scanResult) && (scanChecks.length === 0 || visibleScanChecks >= scanChecks.length);
  const scanNetworkMismatch = Boolean(
    scanResult && normalizeScanNetworkId(scanResult.chain) !== normalizeScanNetworkId(selectedNetwork.id),
  );
  const detectedScanNetworkLabel = scanResult ? getNetworkLabel(scanResult.chain) : "";
  const scoreReasons = [...scanChecks]
    .filter((check) => check.score !== null && check.score >= 25)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, 4);
  const cleanChecks = scanChecks.filter((check) => check.score !== null && check.score < 25);

  async function runTokenScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scanQuery.trim() || scanInFlightRef.current) {
      return;
    }

    scanInFlightRef.current = true;
    scanStageIndexRef.current = 0;
    setIsScanModalOpen(true);
    setIsScanning(true);
    setScanResult(null);
    setScanError(null);
    setScanStageIndex(0);
    setVisibleScanChecks(0);
    setIsScoreReasonOpen(false);

    try {
      const response = await fetch("/api/scan/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: scanQuery.trim(), chain: selectedNetwork.id, walletAddress: address }),
      });

      if (!response.ok) throw new Error("Token scan failed.");

      const data = (await response.json()) as TokenScanResult;
      setVisibleScanChecks(scanStageIndexRef.current);
      setScanResult(data);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Token scan failed.");
    } finally {
      scanInFlightRef.current = false;
      setIsScanning(false);
    }
  }

  async function runDashboardAgents() {
    if (!portfolio) {
      return;
    }

    const walletAddress = address ?? portfolio.walletAddress;

    setIsDashboardRunOpen(true);
    setIsRunningAgents(true);
    setDashboardRunSteps(getInitialDashboardSteps());
    setDashboardAgentResults([]);
    setDashboardRunSummary(null);

    const setStep = (key: DashboardAgentKey, status: DashboardStepStatus, detail?: string) => {
      setDashboardRunSteps((steps) =>
        steps.map((step) => (step.key === key ? { ...step, status, detail: detail ?? step.detail } : step)),
      );
    };

    const pushResult = (result: AgentResult) => {
      setDashboardAgentResults((results) => [...results.filter((item) => item.agent !== result.agent), result]);
    };

    try {
      setStep("portfolio", "running", "Reading wallet");
      const portfolioResult = await postAgentResult("/api/agents/portfolio", { walletAddress });
      pushResult(portfolioResult);
      setStep("portfolio", "complete", portfolioResult.verdict);

      const riskyToken = getRiskiestHolding(portfolio.holdings);
      const specialistTasks: Promise<AgentResult | null>[] = [];

      setDashboardRunSummary({ riskyToken });

      if (riskyToken && (isEvmAddress(riskyToken.tokenAddress) || riskyToken.chainName?.toLowerCase().includes("stellar"))) {
        specialistTasks.push(
          (async () => {
            setStep("onchain", "running", riskyToken.symbol);
            try {
              const result = await postAgentResult("/api/agents/onchain", {
                chain: riskyToken.chainId ?? riskyToken.chainName ?? selectedNetwork.id,
                contractAddress: riskyToken.tokenAddress,
              });

              pushResult(result);
              setStep("onchain", "complete", result.verdict);

              return result;
            } catch {
              setStep("onchain", "error", "Source failed");

              return null;
            }
          })(),
        );
      } else {
        setStep("onchain", "skipped", "No supported asset identity");
      }

      if (riskyToken) {
        specialistTasks.push(
          (async () => {
            setStep("news", "running", riskyToken.symbol);
            try {
              const result = await postAgentResult("/api/agents/news", {
                tokenName: riskyToken.name,
                symbol: riskyToken.symbol,
                contractAddress: riskyToken.tokenAddress,
              });

              pushResult(result);
              setStep("news", "complete", result.verdict);

              return result;
            } catch {
              setStep("news", "error", "Source failed");

              return null;
            }
          })(),
        );
        specialistTasks.push(
          (async () => {
            setStep("social", "running", riskyToken.symbol);
            try {
              const result = await postAgentResult("/api/agents/social", {
                query: riskyToken.symbol,
                symbol: riskyToken.symbol,
                tokenName: riskyToken.name,
              });

              pushResult(result);
              setStep("social", "complete", result.verdict);

              return result;
            } catch {
              setStep("social", "error", "Source failed");

              return null;
            }
          })(),
        );
      } else {
        setStep("news", "skipped", "No token");
        setStep("social", "skipped", "No token");
      }

      const specialistResults = (await Promise.all(specialistTasks)).filter((result): result is AgentResult => Boolean(result));
      const decisionInputs = [portfolioResult, ...specialistResults];

      setStep("decision", "running", "Combining signals");
      const decisionResult = await postAgentResult("/api/agents/decision", { results: decisionInputs });
      pushResult(decisionResult);
      setStep("decision", "complete", decisionResult.verdict);
      setDashboardRunSummary({ riskyToken, final: decisionResult, saveStatus: "saving" });
      const saveResponse = await fetch("/api/history/agent-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress,
          targetToken: riskyToken
            ? {
                symbol: riskyToken.symbol,
                name: riskyToken.name,
                tokenAddress: riskyToken.tokenAddress,
                chain: riskyToken.chainId ?? riskyToken.chainName,
                riskScore: riskyToken.riskScore,
                allocationPercent: riskyToken.allocationPercent,
              }
            : undefined,
          results: [...decisionInputs, decisionResult],
        }),
      });

      if (!saveResponse.ok) {
        setDashboardRunSummary({ riskyToken, final: decisionResult, saveStatus: "error" });
      } else {
        const saved = (await saveResponse.json()) as { id?: string };

        setDashboardRunSummary({ riskyToken, final: decisionResult, recordId: saved.id, saveStatus: "saved" });
      }
    } catch (error) {
      setDashboardRunSummary({
        error: error instanceof Error ? error.message : "Agent run failed",
      });
      setStep("portfolio", "error", "Run failed");
    } finally {
      setIsRunningAgents(false);
    }
  }

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
        <div className="mt-4 grid items-stretch gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <WalletPortfolioCard portfolio={portfolio} walletAddress={address} />
          <RiskScoreCard score={portfolio.riskScore} holdings={portfolio.holdings} />
        </div>
      </section>

      <section className="flex flex-col gap-3 border-y border-white/10 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-white/62">{riskDrivers.suggestedRebalance}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <span><span className="text-white/38">Largest</span> {riskDrivers.largestHolding?.symbol ?? "N/A"} {riskDrivers.largestHolding?.allocationPercent.toFixed(1) ?? "0.0"}%</span>
          <span><span className="text-white/38">Stable</span> {riskDrivers.stableReserve.toFixed(1)}%</span>
          <span><span className="text-white/38">Exit risk</span> {riskDrivers.liquidityExitRisk.toFixed(1)}%</span>
        </div>
      </section>

      <section className="glass-panel rounded-lg p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Portfolio decision</h2>
            <div className="mt-1 text-sm text-white/46">{dashboardRunSummary?.final ? `${dashboardRunSummary.final.verdict} - ${dashboardRunSummary.final.recommendedAction.replaceAll("_", " ")}` : "Analyze the highest-risk holding."}</div>
          </div>
          <div className="flex gap-2">
            {dashboardAgentResults.length > 0 ? (
              <button
                type="button"
                onClick={() => setIsDashboardRunOpen(true)}
                className="inline-flex h-11 items-center justify-center rounded-full border border-white/10 px-4 text-sm font-semibold text-white/70 transition hover:text-white"
              >
                View result
              </button>
            ) : null}
            <button
              type="button"
              onClick={runDashboardAgents}
              disabled={isRunningAgents}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-5 text-sm font-semibold text-black transition hover:bg-[#f2c86d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRunningAgents ? "Running portfolio agents" : "Run portfolio agents"}
              {isRunningAgents ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#d9a441]/20 bg-[#d9a441]/7 p-5">
        <div className="grid gap-4 lg:grid-cols-[.55fr_1.45fr] lg:items-center">
          <div>
            <div className="text-xl font-semibold">Scan token</div>
          </div>
          <form onSubmit={runTokenScan} className="flex flex-col gap-3 sm:flex-row">
            <div className="relative sm:w-56">
              <button
                type="button"
                onClick={() => setIsNetworkOpen((isOpen) => !isOpen)}
                className="flex h-12 w-full items-center justify-between gap-3 rounded-full border border-[#d9a441]/35 bg-black/20 px-4 text-sm text-white/76 outline-none transition hover:border-[#d9a441]/60"
              >
                <span className="flex items-center gap-3">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${selectedNetwork.color}`}>
                    {selectedNetwork.mark}
                  </span>
                  {selectedNetwork.name}
                </span>
                <ChevronDown className={isNetworkOpen ? "h-4 w-4 rotate-180 text-white/48 transition" : "h-4 w-4 text-white/48 transition"} />
              </button>

              {isNetworkOpen ? (
                <div className="absolute bottom-14 left-0 z-50 flex max-h-96 w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#101012] shadow-2xl sm:w-80">
                  <div className="sticky top-0 z-10 border-b border-white/10 bg-[#101012] p-2">
                    <div className="flex h-10 items-center gap-2 rounded-lg bg-white/6 px-3">
                      <Search className="h-4 w-4 shrink-0 text-white/34" />
                      <input
                        autoFocus
                        value={networkSearch}
                        onChange={(event) => setNetworkSearch(event.target.value)}
                        placeholder="Find network"
                        className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/28"
                      />
                    </div>
                  </div>
                  <div className="overflow-y-auto py-1">
                  {filteredNetworks.map((network) => (
                    <button
                      key={network.id}
                      type="button"
                      onClick={() => {
                        setSelectedNetwork(network);
                        setIsNetworkOpen(false);
                        setNetworkSearch("");
                      }}
                      className="flex h-12 w-full items-center justify-between px-4 text-left text-sm text-white/78 transition hover:bg-white/7"
                    >
                      <span className="flex items-center gap-3">
                        <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${network.color}`}>
                          {network.mark}
                        </span>
                        {network.name}
                      </span>
                      {network.id === selectedNetwork.id ? <Check className="h-4 w-4 text-[#d9a441]" /> : null}
                    </button>
                  ))}
                  {filteredNetworks.length === 0 ? <div className="px-4 py-8 text-center text-sm text-white/34">No network found</div> : null}
                  </div>
                </div>
              ) : null}
            </div>
            <input
              name="query"
              value={scanQuery}
              onChange={(event) => setScanQuery(event.target.value)}
              placeholder="Contract address"
              className="h-12 min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-5 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-[#d9a441]/60"
            />
            <button
              type="submit"
              disabled={isScanning || !scanQuery.trim()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-5 text-sm font-semibold text-black transition hover:bg-[#f2c86d]"
            >
              {isScanning ? "Running token agents" : "Run token agents"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </div>
      </section>

      {isScanModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-5 backdrop-blur-md">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0b0b0c] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-white/38">Token scan</div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <h2 className="text-2xl font-semibold">{scanResult?.symbol ?? "Analyzing"}</h2>
                  <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-white/52">
                    {scanResult ? getNetworkLabel(scanResult.chain) : selectedNetwork.name}
                  </span>
                  {scanResult && normalizeScanNetworkId(scanResult.chain) !== normalizeScanNetworkId(selectedNetwork.id) ? (
                    <span className="rounded-full border border-[#d9a441]/30 bg-[#d9a441]/10 px-3 py-1 text-xs text-[#f2c86d]">Network auto-detected</span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsScanModalOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-white/42 transition hover:bg-white/8 hover:text-white"
                aria-label="Close token scan"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {scanNetworkMismatch ? (
              <div className="mt-5 flex items-start gap-3 rounded-lg border border-[#d9a441]/30 bg-[#d9a441]/8 p-4 text-[#f2c86d]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <div className="text-sm font-semibold">Contract network detected: {detectedScanNetworkLabel}</div>
                  <div className="mt-1 text-xs leading-5 text-white/52">
                    You selected {selectedNetwork.name}, but this contract was found on {detectedScanNetworkLabel}. The scan automatically used the detected network.
                  </div>
                </div>
              </div>
            ) : null}

            {!scanRevealComplete && !scanError ? (
              <div className="mt-7 flex flex-col items-center text-center">
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <div className="absolute inset-0 animate-ping rounded-full border border-[#d9a441]/20" />
                  <div className="absolute inset-2 animate-pulse rounded-full border border-[#d9a441]/35" />
                  <BrainCircuit className="h-8 w-8 text-[#d9a441]" />
                </div>
                <div className="mt-3 text-sm font-semibold text-white/74">
                  {scanResult ? scanChecks[Math.min(visibleScanChecks, scanChecks.length - 1)]?.label : scanCheckLabels[scanStageIndex]}
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {scanCheckLabels.map((label, index) => {
                const result = scanChecks[index];
                const revealed = Boolean(result && index < visibleScanChecks);
                const active = scanResult ? Boolean(result && index === visibleScanChecks && !scanRevealComplete) : isScanning && index === scanStageIndex;
                const processed = !scanResult && index < scanStageIndex;

                return (
                  <div
                    key={label}
                    className={`flex h-20 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 transition-all duration-300 ${revealed ? getScanCheckTone(result.status) : active ? "border-[#d9a441]/45 bg-[#d9a441]/8 text-[#f2c86d] shadow-[0_0_20px_rgba(217,164,65,.12)]" : processed ? "border-white/12 bg-white/[.04] text-white/52" : "border-white/8 bg-black/20 text-white/25"}`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{label}</div>
                      <div className="mt-1 truncate text-[11px] opacity-65">{revealed ? `${result.value ? `${result.value} · ` : ""}${result.score === null ? "?" : `${result.score}/100`}` : active ? "Checking" : processed ? "Checked" : "Waiting"}</div>
                    </div>
                    <div
                      className="group relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current/25 text-sm font-bold outline-none"
                      tabIndex={revealed ? 0 : -1}
                      aria-label={revealed ? `${result.label}: ${result.reason}` : undefined}
                    >
                      {active ? <Loader2 className="h-4 w-4 animate-spin" /> : revealed ? getScanCheckMark(result.status) : processed ? <Check className="h-4 w-4" /> : "·"}
                      {revealed ? (
                        <div role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-52 rounded-lg border border-white/12 bg-[#171719] px-3 py-2 text-left text-[11px] font-normal leading-4 text-white/72 shadow-2xl group-hover:block group-focus:block">
                          {result.reason}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            {scanError ? <div className="mt-6 flex items-center gap-3 rounded-lg border border-red-300/20 bg-red-400/8 p-4 text-sm text-red-100"><AlertTriangle className="h-4 w-4 shrink-0" />{scanError}</div> : null}

            {scanResult && scanRevealComplete ? (
              <div className="mt-7">
                <div className={`rounded-xl border p-5 ${scanResult.overallRiskScore >= 75 ? "border-red-300/25 bg-red-400/8" : scanResult.overallRiskScore >= 50 ? "border-orange-300/25 bg-orange-400/8" : scanResult.overallRiskScore >= 25 ? "border-[#d9a441]/25 bg-[#d9a441]/8" : "border-emerald-300/25 bg-emerald-300/8"}`}>
                  <div className="flex items-end justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-white/42">
                        Verdict
                        <button
                          type="button"
                          onClick={() => setIsScoreReasonOpen(true)}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white/45 transition hover:bg-white/8 hover:text-white"
                          aria-label="Why this score?"
                          title="Why this score?"
                        >
                          <CircleHelp className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-1 text-xl font-semibold capitalize">{scanResult.riskReport?.verdict.replaceAll("_", " ") ?? scanResult.verdict.replaceAll("_", " ")}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-4xl font-semibold">{scanResult.overallRiskScore}</div>
                      <div className="text-xs text-white/42">risk / 100</div>
                    </div>
                  </div>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-current" style={{ width: `${scanResult.overallRiskScore}%` }} />
                  </div>
                  <StellarRiskPublishButton
                    network={scanResult.chain}
                    assetKey={scanResult.normalizedInput?.assetKey ?? scanResult.normalizedInput?.contractAddress}
                    assetLabel={scanResult.symbol}
                    score={scanResult.overallRiskScore}
                    verdict={scanResult.riskReport?.verdict ?? scanResult.verdict}
                    report={scanResult.riskReport ?? scanResult}
                  />
                </div>

              </div>
            ) : null}

            {isScoreReasonOpen && scanResult && scanRevealComplete ? (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm" onClick={() => setIsScoreReasonOpen(false)}>
                <div className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-xl border border-white/12 bg-[#111113] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs text-white/40">Why this score?</div>
                      <div className="mt-1 text-2xl font-semibold">{scanResult.overallRiskScore}/100</div>
                    </div>
                    <button type="button" onClick={() => setIsScoreReasonOpen(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/42 transition hover:bg-white/8 hover:text-white" aria-label="Close score details">
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="mt-5 space-y-2">
                    {scoreReasons.map((check) => (
                      <div key={check.key} className="border-b border-white/8 pb-3 last:border-0">
                        <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                          <span>{check.label}</span>
                          <span className={check.status === "danger" ? "text-red-200" : "text-[#f2c86d]"}>{check.score}/100</span>
                        </div>
                        <div className="mt-1 text-xs leading-5 text-white/48">{check.reason}</div>
                      </div>
                    ))}
                    {scoreReasons.length === 0 ? <div className="text-sm text-white/48">No elevated contract branch was found.</div> : null}
                  </div>

                  {cleanChecks.length > 0 ? (
                    <div className="mt-4 border-t border-white/10 pt-4">
                      <div className="flex flex-wrap gap-2">
                        {cleanChecks.map((check) => (
                          <span key={check.key} className="rounded-full border border-emerald-300/18 bg-emerald-300/7 px-2.5 py-1 text-[11px] text-emerald-200/75">{check.label} +</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

          </div>
        </div>
      ) : null}

      {isDashboardRunOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-[28px] border border-white/10 bg-[#101010] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.18em] text-[#d9a441]">Agent run</div>
                <h2 className="mt-2 text-2xl font-semibold">
                  {dashboardRunSummary?.final ? dashboardRunSummary.final.verdict : isRunningAgents ? "Agents running" : "Run result"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDashboardRunOpen(false)}
                className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/54 transition hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-6 grid gap-2 sm:grid-cols-5">
              {dashboardRunSteps.map((step) => (
                <div key={step.key} className={`rounded-2xl border p-4 ${getStepTone(step.status)}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">{step.label}</div>
                    {step.status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  </div>
                  <div className="mt-3 text-xs leading-5 opacity-75">{step.detail}</div>
                </div>
              ))}
            </div>

            {dashboardRunSummary?.error ? (
              <div className="mt-5 rounded-2xl border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-100">
                {dashboardRunSummary.error}
              </div>
            ) : null}

            {dashboardRunSummary?.riskyToken ? (
              <div className="mt-5 rounded-2xl border border-[#d9a441]/20 bg-[#d9a441]/8 p-4">
                <div className="text-sm text-white/42">Riskiest holding</div>
                <div className="mt-2 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                  <div>
                    <div className="text-2xl font-semibold">{dashboardRunSummary.riskyToken.symbol}</div>
                    <div className="mt-1 text-sm text-white/46">{dashboardRunSummary.riskyToken.name}</div>
                  </div>
                  <div className="text-sm text-white/54">
                    {dashboardRunSummary.riskyToken.riskScore}/100 risk · {dashboardRunSummary.riskyToken.allocationPercent.toFixed(1)}% allocation
                  </div>
                </div>
              </div>
            ) : null}

            {dashboardRunSummary?.final ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-white/6 p-4">
                  <div className="text-sm text-white/42">Decision score</div>
                  <div className="mt-1 text-3xl font-semibold">{dashboardRunSummary.final.score}</div>
                </div>
                <div className="rounded-2xl bg-white/6 p-4">
                  <div className="text-sm text-white/42">Action</div>
                  <div className="mt-2 text-lg font-semibold capitalize">{dashboardRunSummary.final.recommendedAction.replaceAll("_", " ")}</div>
                </div>
                <div className="rounded-2xl bg-white/6 p-4">
                  <div className="text-sm text-white/42">Confidence</div>
                  <div className="mt-1 text-3xl font-semibold">{Math.round(dashboardRunSummary.final.confidence * 100)}%</div>
                </div>
              </div>
            ) : null}

            {dashboardRunSummary?.final && dashboardRunSummary.final.recommendedAction !== "no_action" && dashboardRunSummary.final.recommendedAction !== "manual_review" && dashboardRunSummary.final.recommendedAction !== "avoid" ? (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={async () => {
                    const riskyToken = dashboardRunSummary?.riskyToken;
                    const holding = riskyToken
                      ? portfolio?.holdings.find((h) => h.tokenAddress === riskyToken.tokenAddress)
                      : undefined;
                    const action = dashboardRunSummary?.final?.recommendedAction;
                    const fromAddress = riskyToken?.tokenAddress;
                    const toAddress = family === "stellar" ? "USDC" : undefined;
                    const estimatedValue = holding?.valueUsd;

                    // Build expected effects from the decision data so the
                    // prepared transaction has meaningful metadata. The server
                    // cross-validates these against its own execution preview.
                    //
                    // Include `method` so the server can derive a 4‑byte EVM
                    // function selector (or Stellar operation type) for the
                    // approval flow.  The selector is minimal — a connected DEX
                    // aggregator supplies full argument data in production.
                    const swapMethod = "swapExactTokensForTokens";
                    const expectedEffects = riskyToken
                      ? [
                          {
                            kind: "swap" as const,
                            fromToken: riskyToken.tokenAddress,
                            toToken: toAddress ?? "USDC",
                            fromAddress: address ?? undefined,
                            toAddress: toAddress ?? undefined,
                            amount: estimatedValue ? `${(estimatedValue * 0.3).toFixed(2)}` : undefined,
                            contractAddress: fromAddress,
                            method: swapMethod,
                            assetKey: riskyToken.symbol,
                          },
                        ]
                      : undefined;

                    try {
                      const prepareResponse = await fetch("/api/execute/prepare", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          walletAddress: address,
                          network: chain,
                          chainFamily: (chain?.toLowerCase().startsWith("stellar") ? "stellar" : "evm") as "evm" | "stellar",
                          action: action,
                          fromToken: riskyToken?.tokenAddress,
                          estimatedValueUsd: estimatedValue,
                          expectedEffects,
                          slippageBps: 100,
                          idempotencyKey: `exec:${address}:${action ?? "unknown"}:${Date.now()}`,
                        }),
                      });

                      if (!prepareResponse.ok) {
                        const err = await prepareResponse.json().catch(() => ({}));
                        throw new Error(err.error ?? (err.detail ?? "Prepare failed."));
                      }

                      const prepareResult = await prepareResponse.json();
                      const key = prepareResult.lifecycle?.idempotencyKey;
                      if (!key) throw new Error("No idempotency key returned from prepare.");

                      setApprovalPrepareData({
                        idempotencyKey: key,
                        chainFamily: (chain?.toLowerCase().startsWith("stellar") ? "stellar" : "evm") as "evm" | "stellar",
                        network: chain ?? "ethereum",
                        walletAddress: address ?? "",
                        sourceAccount: family === "stellar" ? address ?? undefined : undefined,
                      });
                      setApprovalFlowOpen(true);
                    } catch (error) {
                      console.error("Prepare failed:", error);
                      setDashboardRunSummary((prev) =>
                        prev
                          ? { ...prev, error: error instanceof Error ? error.message : "Failed to prepare transaction." }
                          : prev,
                      );
                    }
                  }}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-emerald-500/20 px-5 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-500/30"
                >
                  Prepare &amp; sign transaction
                </button>
              </div>
            ) : null}

            {dashboardRunSummary?.saveStatus ? (
              <div className="mt-5 rounded-2xl border border-white/10 bg-white/6 p-4 text-sm text-white/52">
                {dashboardRunSummary.saveStatus === "saving"
                  ? "Saving audit record..."
                  : dashboardRunSummary.saveStatus === "saved"
                    ? `Audit record saved${dashboardRunSummary.recordId ? `: ${dashboardRunSummary.recordId}` : "."}`
                    : dashboardRunSummary.saveStatus === "error"
                      ? "Decision finished, but audit record could not be saved."
                      : null}
              </div>
            ) : null}

            {dashboardAgentResults.length === 0 && !isRunningAgents ? (
              <div className="mt-5">
                <NoDataState title="No agent result yet" detail="Run the agent stack to populate score breakdown, sources and missing data." />
              </div>
            ) : null}

            <div className="mt-5 space-y-3">
              {dashboardAgentResults.map((result) => (
                <AgentResultPanel key={result.agent} result={result} />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {approvalFlowOpen && approvalPrepareData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-5 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-white/10 bg-[#101010] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm uppercase tracking-[0.18em] text-[#d9a441]">Sign transaction</div>
                <h2 className="mt-2 text-xl font-semibold">Wallet approval required</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setApprovalFlowOpen(false);
                  setApprovalPrepareData(null);
                }}
                className="rounded-full border border-white/10 px-3 py-1 text-sm text-white/54 transition hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="mt-5">
              <ApprovalFlowClient
                idempotencyKey={approvalPrepareData.idempotencyKey}
                walletAddress={approvalPrepareData.walletAddress}
                chainFamily={approvalPrepareData.chainFamily}
                network={approvalPrepareData.network}
                sourceAccount={approvalPrepareData.sourceAccount}
                onComplete={(txHash) => {
                  setApprovalFlowOpen(false);
                  setApprovalPrepareData(null);
                  setIsDashboardRunOpen(false);
                  alert(`Transaction submitted! Hash: ${txHash}`);
                }}
                onDismiss={() => {
                  setApprovalFlowOpen(false);
                  setApprovalPrepareData(null);
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
