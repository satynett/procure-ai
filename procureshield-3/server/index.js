  } catch {
    return [];
  }
}

function decorateTender(tender, bids, bidders) {
  const tenderBids = bids.filter((b) => b.tender_id === tender.tender_id);
  const winnerBid = tender.status === "Awarded" && tenderBids.length
    ? (tender.winner_bid_id
      ? tenderBids.find((b) => b.bid_id === tender.winner_bid_id) || null
      : tenderBids.slice().sort((a, b) => Number(a.bid_amount || Infinity) - Number(b.bid_amount || Infinity))[0])
    : null;
  const winner = winnerBid ? bidders.find((b) => b.bidder_id === winnerBid.bidder_id) : null;
  return {
    ...tender,
    bid_count: tenderBids.length,
    winner_name: winner?.company_name || null,
    winner_bid_id: winnerBid?.bid_id || null,
    award_amount: winnerBid?.bid_amount || null,
  };
}

function getAuditLog() {
  try {
    return readJson("auditLog.json");
  } catch {
    return [];
  }
}
function appendAuditLog(entry) {
  const log = getAuditLog();
  log.unshift(entry);
  writeJson("auditLog.json", log);