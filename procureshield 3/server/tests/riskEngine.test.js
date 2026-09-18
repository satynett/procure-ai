import test from "node:test";
import assert from "node:assert/strict";
import { compareBidders, riskCategory, buildRelationshipGraph, maskAccount, maskPhone } from "../utils/riskEngine.js";

function bidder(overrides = {}) {
  return {
    bidder_id: "B-1",
    company_name: "Test Co",
    director_name: "Ravi Kumar",
    address: "123 MG Road, Pune, Maharashtra",
    phone: "9876543210",
    bank_account: "111122223333",
    gst_number: "27ABCDE1234F1Z5",
    pan_number: "ABCDE1234F",
    bids: [],
    ...overrides,
  };
}

test("compareBidders detects shared director as a strong signal", () => {
  const a = bidder({ bidder_id: "B-1" });
  const b = bidder({ bidder_id: "B-2", address: "999 Different Street, Delhi" });
  const { score, evidence } = compareBidders(a, b);
  assert.ok(evidence.includes("sharedDirector"));
  assert.ok(score >= 30);
});

test("compareBidders finds no signals between unrelated bidders", () => {
  const a = bidder({ bidder_id: "B-1" });
  const b = bidder({
    bidder_id: "B-2",
    director_name: "Anita Sharma",
    address: "45 Park Street, Kolkata",
    phone: "9000000000",
    bank_account: "444455556666",
    gst_number: "19XYZAB9876C1Z3",
    pan_number: "XYZAB9876C",
  });
  const { score, evidence } = compareBidders(a, b);
  assert.equal(score, 0);
  assert.equal(evidence.length, 0);
});

test("score is clamped between 0 and 100", () => {
  const a = bidder({ bidder_id: "B-1" });
  const b = bidder({ bidder_id: "B-2" }); // identical on every field -> every signal fires
  const { score } = compareBidders(a, b);
  assert.ok(score <= 100);
  assert.ok(score >= 0);
});

test("riskCategory boundaries match documented thresholds", () => {
  assert.equal(riskCategory(0), "Low");
  assert.equal(riskCategory(30), "Low");
  assert.equal(riskCategory(31), "Medium");
  assert.equal(riskCategory(60), "Medium");
  assert.equal(riskCategory(61), "High");
  assert.equal(riskCategory(80), "High");
  assert.equal(riskCategory(81), "Critical");
  assert.equal(riskCategory(100), "Critical");
});

test("weak-only signals never merge bidders into a cluster (avoids false-positive grouping)", () => {
  // Same GST-state prefix and overlapping bidding categories only -> weak signals.
  const a = bidder({
    bidder_id: "B-1",
    director_name: "Suresh Mehta",
    address: "12 Linking Road, Mumbai, Maharashtra",
    phone: "9111111111",
    bank_account: "aaaa",
    gst_number: "27AAAAA0000A1Z1",
    bids: [{ category: "Electronics" }, { category: "Furniture" }],
  });
  const b = bidder({
    bidder_id: "B-2",
    director_name: "Priya Nair",
    address: "78 Residency Road, Bengaluru, Karnataka",
    phone: "9222222222",
    bank_account: "bbbb",
    gst_number: "27BBBBB1111B1Z2",
    bids: [{ category: "Electronics" }, { category: "Furniture" }],
  });
  const { clusters } = buildRelationshipGraph([a, b]);
  assert.equal(clusters.length, 0, "weak signals alone must not create a cluster");
});

test("a shared bank account links two bidders into a cluster", () => {
  const a = bidder({ bidder_id: "B-1", bank_account: "999900001111" });
  const b = bidder({
    bidder_id: "B-2",
    director_name: "Different Director",
    address: "Totally different address, Chennai",
    phone: "9333333333",
    bank_account: "999900001111",
    gst_number: "33ZZZZZ0000Z1Z9",
    pan_number: "ZZZZZ0000Z",
  });
  const { clusters } = buildRelationshipGraph([a, b]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(new Set(clusters[0].members), new Set(["B-1", "B-2"]));
});

test("maskAccount / maskPhone never leak the full value", () => {
  assert.equal(maskAccount("123456789012"), "XXXX XXXX 9012");
  assert.equal(maskPhone("9876543210"), "98XXXXXX10");
});
