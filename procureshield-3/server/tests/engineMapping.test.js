import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBidderRiskMap,
  buildClusters,
  buildEdges,
  buildEngineRecords,
  inferTenderWinners,
  maskAccount,
  maskPhone,
  riskCategory,
  signalLabel,
  slugPerson,
  uiEvidenceCode,
} from "../utils/engineMapping.js";
import { registryEdges, registryEvidenceFor } from "../utils/registrySignals.js";

// Replaces the old riskEngine.test.js. There is no scoring logic left in this
// server to test - these cover the translation layer between the GeM demo
// data and the ProcureShield engine, which is where integration bugs live.

const BIDDERS = [
  {
    bidder_id: "BID-1",
    company_name: "Alpha Traders",
    director_name: "Rahul Sharma",
    address: "24 MG Road, Delhi",
    phone: "9812345621",
    bank_account: "500123440091",
  },
  {
    bidder_id: "BID-2",
    company_name: "Beta Works",
    director_name: "Rahul Sharma",
    address: "24-A MG Road, Delhi",
    phone: "9812345621",
    bank_account: "500123440092",
  },
  {
    bidder_id: "BID-3",
    company_name: "Gamma Supplies",
    director_name: "Nisha Patel",
    address: "9 Link Road, Pune",
    phone: "9800000000",
    bank_account: "500123440092",
  },
];

const BIDS = [
  { bid_id: "B-1", tender_id: "T-1", bidder_id: "BID-1", bid_amount: 100, submission_date: "2026-01-02", category: "IT" },
  { bid_id: "B-2", tender_id: "T-1", bidder_id: "BID-2", bid_amount: 90, submission_date: "2026-01-02", category: "IT" },
  { bid_id: "B-3", tender_id: "T-2", bidder_id: "BID-3", bid_amount: 500, submission_date: "2026-01-09", category: "Furniture" },
];

// --------------------------------------------------------------- mapping
test("the lowest bid in a tender is mapped as the winner (L1)", () => {
  const winners = inferTenderWinners(BIDS);
  assert.equal(winners.get("T-1"), "B-2");
  assert.equal(winners.get("T-2"), "B-3");
});

test("tender winner selection is deterministic when amounts tie", () => {
  const tied = [
    { bid_id: "B-z", tender_id: "T-9", bidder_id: "BID-1", bid_amount: 100 },
    { bid_id: "B-a", tender_id: "T-9", bidder_id: "BID-2", bid_amount: 100 },
  ];
  assert.equal(inferTenderWinners(tied).get("T-9"), "B-a");
  assert.equal(inferTenderWinners(tied.slice().reverse()).get("T-9"), "B-a");
});

test("engine records carry identity, price and result fields", () => {
  const records = buildEngineRecords(BIDDERS, BIDS);
  assert.equal(records.length, 3);
  const winner = records.find((r) => r.tender_id === "T-1" && r.company_id === "BID-2");
  assert.equal(winner.result, "win");
  assert.equal(winner.person_name, "Rahul Sharma");
  assert.equal(winner.person_id, slugPerson("Rahul Sharma"));
  assert.equal(winner.bid_amount, 90);
  assert.equal(winner.department_id, "IT");
  const loser = records.find((r) => r.tender_id === "T-1" && r.company_id === "BID-1");
  assert.equal(loser.result, "loss");
});

test("tender_value is never fabricated", () => {
  const records = buildEngineRecords(BIDDERS, BIDS);
  assert.ok(records.every((r) => !("tender_value" in r)));
});

test("bids from unknown bidders are dropped rather than sent with a null company", () => {
  const records = buildEngineRecords(BIDDERS, [
    ...BIDS,
    { bid_id: "B-x", tender_id: "T-3", bidder_id: "BID-999", bid_amount: 10 },
  ]);
  assert.ok(records.every((r) => r.company_id !== "BID-999"));
});

test("two bidders sharing a director produce the same person id", () => {
  const records = buildEngineRecords(BIDDERS, BIDS);
  const a = records.find((r) => r.company_id === "BID-1").person_id;
  const b = records.find((r) => r.company_id === "BID-2").person_id;
  assert.equal(a, b);
});

// --------------------------------------------------------------- banding
test("risk bands mirror the engine boundaries", () => {
  assert.equal(riskCategory(10), "Low");
  assert.equal(riskCategory(25), "Low");
  assert.equal(riskCategory(26), "Medium");
  assert.equal(riskCategory(50), "Medium");
  assert.equal(riskCategory(51), "High");
  assert.equal(riskCategory(75), "High");
  assert.equal(riskCategory(76), "Critical");
});

test("engine signal codes map to UI codes and readable labels", () => {
  assert.equal(uiEvidenceCode("SHARED_DIRECTORS"), "sharedDirector");
  assert.equal(uiEvidenceCode("COVER_BID_PATTERN"), "coverBidPattern");
  assert.equal(signalLabel("WINNER_ROTATION"), "Winner Rotation");
  assert.equal(uiEvidenceCode("SOMETHING_NEW"), "SOMETHING_NEW");
});

// --------------------------------------------------- risk map / clusters
const ANALYSIS = {
  entities: {
    "C_aaa": {
      entity_id: "C_aaa",
      aliases: ["BID-1"],
      risk_score: 78.4,
      explanation: "Indicators triggered.",
      recommended_actions: ["Pull registry filings."],
      model_probability: 0.9,
      risk_signals: [
        { code: "SHARED_DIRECTORS", severity: 1, weight: 1, description: "Shares an officer." },
        { code: "WINNER_ROTATION", severity: 0.5, weight: 1, description: "Wins rotate." },
      ],
    },
    "C_bbb": {
      entity_id: "C_bbb",
      aliases: ["BID-2"],
      risk_score: 61,
      explanation: "Indicators triggered.",
      recommended_actions: [],
      risk_signals: [{ code: "SHARED_DIRECTORS", severity: 1, weight: 1, description: "Shares an officer." }],
    },
  },
};

test("entity scores are mapped back onto raw bidder ids via aliases", () => {
  const map = buildBidderRiskMap(ANALYSIS, ["BID-1", "BID-2", "BID-3"]);
  assert.equal(map["BID-1"].score, 78);
  assert.equal(map["BID-1"].category, "Critical");
  assert.equal(map["BID-2"].score, 61);
  assert.equal(map["BID-1"].signals[0].ui_code, "sharedDirector");
});

test("bidders absent from the engine output default to a zero score, not undefined", () => {
  const map = buildBidderRiskMap(ANALYSIS, ["BID-1", "BID-3"]);
  assert.equal(map["BID-3"].score, 0);
  assert.equal(map["BID-3"].category, "Low");
  assert.deepEqual(map["BID-3"].signals, []);
});

test("relationships become edges and only strong signals are linkable", () => {
  const entityToRaw = new Map([["C_aaa", "BID-1"], ["C_bbb", "BID-2"]]);
  const edges = buildEdges(
    [
      {
        company_a: "C_aaa",
        company_b: "C_bbb",
        shared_directors: 1,
        shared_addresses: 0,
        shared_tenders: 4,
        alternating_wins: 2,
        relationship_risk: 0.9,
        reasons: ["1 shared officer(s) on both companies"],
      },
    ],
    entityToRaw
  );
  assert.equal(edges.length, 1);
  assert.equal(edges[0].score, 90);
  assert.equal(edges[0].linkable, true);
  assert.deepEqual(edges[0].evidence, ["sharedDirector", "repeatedCoBidding", "winnerRotation"]);
});

test("co-bidding alone does not link two bidders into a network", () => {
  const edges = buildEdges(
    [
      {
        company_a: "A",
        company_b: "B",
        shared_directors: 0,
        shared_addresses: 0,
        shared_tenders: 6,
        alternating_wins: 0,
        relationship_risk: 0.4,
        reasons: [],
      },
    ],
    new Map()
  );
  assert.equal(edges[0].linkable, false);
});

test("registry edges merge into an existing engine edge instead of duplicating it", () => {
  const edges = buildEdges(
    [
      {
        company_a: "C_aaa",
        company_b: "C_bbb",
        shared_directors: 1,
        shared_addresses: 0,
        shared_tenders: 0,
        alternating_wins: 0,
        relationship_risk: 0.5,
        reasons: ["1 shared officer(s) on both companies"],
      },
    ],
    new Map([["C_aaa", "BID-1"], ["C_bbb", "BID-2"]]),
    registryEdges(BIDDERS)
  );
  const pair = edges.filter(
    (e) => [e.source, e.target].sort().join() === ["BID-1", "BID-2"].sort().join()
  );
  assert.equal(pair.length, 1, "engine and registry evidence must share one edge");
  assert.ok(pair[0].evidence.includes("sharedDirector"));
  assert.ok(pair[0].evidence.includes("sharedPhone"));
});

test("clusters form over linkable edges and inherit the top member score", () => {
  const riskMap = buildBidderRiskMap(ANALYSIS, ["BID-1", "BID-2", "BID-3"]);
  const edges = [
    { source: "BID-1", target: "BID-2", score: 90, evidence: ["sharedDirector"], reasons: [], linkable: true },
    { source: "BID-2", target: "BID-3", score: 20, evidence: ["repeatedCoBidding"], reasons: [], linkable: false },
  ];
  const clusters = buildClusters(edges, ["BID-1", "BID-2", "BID-3"], riskMap);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].members, ["BID-1", "BID-2"]);
  assert.equal(clusters[0].risk_score, 78);
  assert.equal(clusters[0].risk_category, "Critical");
  assert.equal(riskMap["BID-1"].cluster_id, "CLU-01");
  assert.equal(riskMap["BID-3"].cluster_id, null);
});

test("cluster signal breakdown is ordered by contribution", () => {
  const riskMap = buildBidderRiskMap(ANALYSIS, ["BID-1", "BID-2"]);
  const clusters = buildClusters(
    [{ source: "BID-1", target: "BID-2", score: 90, evidence: [], reasons: [], linkable: true }],
    ["BID-1", "BID-2"],
    riskMap
  );
  const codes = clusters[0].signal_breakdown.map((s) => s.code);
  assert.deepEqual(codes, ["sharedDirector", "winnerRotation"]);
});

test("a lone bidder is not a cluster", () => {
  const riskMap = buildBidderRiskMap(ANALYSIS, ["BID-1"]);
  assert.deepEqual(buildClusters([], ["BID-1"], riskMap), []);
});

// -------------------------------------------------------- registry signals
test("shared phone and shared bank account are detected exactly", () => {
  const edges = registryEdges(BIDDERS);
  const phone = edges.find((e) => e.evidence.includes("sharedPhone"));
  const bank = edges.find((e) => e.evidence.includes("sharedBank"));
  assert.deepEqual([phone.source, phone.target], ["BID-1", "BID-2"]);
  assert.deepEqual([bank.source, bank.target], ["BID-2", "BID-3"]);
});

test("empty or missing registry fields never link bidders", () => {
  const edges = registryEdges([
    { bidder_id: "X", phone: "", bank_account: null },
    { bidder_id: "Y", phone: "", bank_account: null },
  ]);
  assert.deepEqual(edges, []);
});

test("registry evidence is resolved per bidder", () => {
  const edges = registryEdges(BIDDERS);
  assert.deepEqual(registryEvidenceFor("BID-1", edges), ["sharedPhone"]);
  assert.deepEqual(registryEvidenceFor("BID-3", edges), ["sharedBank"]);
  assert.deepEqual(registryEvidenceFor("BID-404", edges), []);
});

// ---------------------------------------------------------------- masking
test("phone and account numbers are masked for display", () => {
  assert.equal(maskPhone("9812345621"), "98XXXXXX21");
  assert.equal(maskAccount("500123440091"), "XXXX XXXX 0091");
  assert.equal(maskAccount("12"), "12");
});
