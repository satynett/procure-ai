import test from "node:test";
import assert from "node:assert/strict";
import { buildChecklist } from "../utils/checklist.js";

function baseBidder(overrides = {}) {
  return {
    gst_number: "27ABCDE1234F1Z5",
    pan_number: "ABCDE1234F",
    msme_status: "Yes",
    ...overrides,
  };
}

test("valid GST and PAN pass structural verification", () => {
  const items = buildChecklist({ bidder: baseBidder(), bid: {}, evidenceForBidder: [] });
  const gst = items.find((i) => i.key === "gst");
  const pan = items.find((i) => i.key === "pan");
  assert.equal(gst.status, "verified");
  assert.equal(pan.status, "verified");
});

test("malformed GST/PAN are flagged as failed, not silently passed", () => {
  const items = buildChecklist({
    bidder: baseBidder({ gst_number: "not-a-gst", pan_number: "bad" }),
    bid: {},
    evidenceForBidder: [],
  });
  assert.equal(items.find((i) => i.key === "gst").status, "failed");
  assert.equal(items.find((i) => i.key === "pan").status, "failed");
});

test("shared-director evidence produces a warning, not an accusation", () => {
  const items = buildChecklist({
    bidder: baseBidder(),
    bid: {},
    evidenceForBidder: ["sharedDirector"],
  });
  const director = items.find((i) => i.key === "director");
  assert.equal(director.status, "warning");
  assert.ok(!/fraud|cartel|collusion/i.test(director.explanation), "explanation must stay evidence-based, never accusatory");
});

test("every checklist item includes a confidence score and explanation", () => {
  const items = buildChecklist({ bidder: baseBidder(), bid: {}, evidenceForBidder: [] });
  for (const item of items) {
    assert.ok(typeof item.confidence === "number");
    assert.ok(item.confidence >= 0 && item.confidence <= 100);
    assert.ok(item.explanation && item.explanation.length > 0);
  }
});
