// gen-data.js
// Generator for realistic SYNTHETIC/SANDBOX GeM-style demo data.
// Run with: npm run gen-data   (writes server/data/bidders.json + bids.json)
//
// This generator is TENDER-centric: every tender is contested by several
// bidders, which is what the ProcureShield engine needs in order to evaluate
// its behavioural signals (repeat co-bidding, cover bidding, winner rotation,
// bid-price similarity). A dataset of single-bidder tenders can only ever
// trigger the identity signals.
//
// It computes NO risk scores. Scoring is the engine's job; this file only
// produces the raw bid records an officer would actually see, plus optional
// `label` values marking known-collusive bidders so the GAT can be trained.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const categories = [
  "IT Hardware",
  "Office Supplies",
  "Construction Materials",
  "Medical Equipment",
  "Furniture",
  "Electrical Goods",
  "Vehicles & Transport",
  "Cleaning Services",
  "Stationery",
  "Security Services",
];

// --- Base bidder records -----------------------------------------------
// Cluster "CLU-A" (becomes Cluster #07 in the UI narrative): shared director,
// shared address, shared phone -> should surface as the flagship demo cluster.
const clusterA = [
  {
    bidder_id: "BID-1001",
    company_name: "Sharma Enterprises",
    director_name: "Rahul Sharma",
    address: "24 MG Road, Delhi",
    phone: "9812345621",
    email: "contact@sharmaenterprises.example",
    gst_number: "07AASFS1234E1Z5",
    pan_number: "AASFS1234E",
    bank_account: "500123440091",
    msme_status: "Yes",
  },
  {
    bidder_id: "BID-1002",
    company_name: "S.K. Solutions",
    director_name: "Rahul Sharma",
    address: "24-A MG Road, Delhi",
    phone: "9812345621",
    email: "info@sksolutions.example",
    gst_number: "07BBTSK5678F1Z2",
    pan_number: "BBTSK5678F",
    bank_account: "500123440092",
    msme_status: "Yes",
  },
  {
    bidder_id: "BID-1003",
    company_name: "Reliable Traders",
    director_name: "Rahul Sharma",
    address: "24 MG Road, New Delhi",
    phone: "9900112233",
    email: "sales@reliabletraders.example",
    gst_number: "07CCRTR9012G1Z8",
    pan_number: "CCRTR9012G",
    bank_account: "500123440093",
    msme_status: "No",
  },
  {
    bidder_id: "BID-1004",
    company_name: "Alpha Enterprises",
    director_name: "Rahul Sharma",
    address: "24 MG Road, Delhi",
    phone: "9812345621",
    email: "hello@alphaenterprises.example",
    gst_number: "07DDALP3456H1Z1",
    pan_number: "DDALP3456H",
    bank_account: "500123440094",
    msme_status: "Yes",
  },
  {
    bidder_id: "BID-1005",
    company_name: "Beta Solutions",
    director_name: "Rahul Sharma",
    address: "24 MG Road, Delhi",
    phone: "9812345621",
    email: "team@betasolutions.example",
    gst_number: "07EEBET7890I1Z4",
    pan_number: "EEBET7890I",
    bank_account: "500123440095",
    msme_status: "Yes",
  },
  {
    bidder_id: "BID-1006",
    company_name: "Gamma Traders",
    director_name: "Rahul Sharma",
    address: "24-B MG Road, Delhi",
    phone: "9812345621",
    email: "office@gammatraders.example",
    gst_number: "07FFGAM2345J1Z7",
    pan_number: "FFGAM2345J",
    bank_account: "500123440096",
    msme_status: "No",
  },
];

// Cluster "CLU-B": shared bank account only
const clusterB = [
  {
    bidder_id: "BID-1007",
    company_name: "Techno Supplies",
    director_name: "Vikram Nair",
    address: "12 Industrial Estate, Pune",
    phone: "9765432110",
    email: "sales@technosupplies.example",
    gst_number: "27GGTEC6789K1Z3",
    pan_number: "GGTEC6789K",
    bank_account: "620044554582",
    msme_status: "Yes",
  },
  {
    bidder_id: "BID-1008",
    company_name: "Digital Solutions",
    director_name: "Ananya Iyer",
    address: "45 Tech Park, Pune",
    phone: "9765432199",
    email: "contact@digitalsolutions.example",
    gst_number: "27HHDIG1122L1Z6",
    pan_number: "HHDIG1122L",
    bank_account: "620044554582",
    msme_status: "Yes",
  },
];

// Independent, unrelated bidders (to show the system does NOT flag everyone)
const independents = [
  { name: "Vishal Agro Traders", dir: "Suresh Menon", city: "Kochi", gstPrefix: "32", msme: "Yes" },
  { name: "Bright Future Textiles", dir: "Kavita Rao", city: "Surat", gstPrefix: "24", msme: "Yes" },
  { name: "Nationwide Logistics Pvt Ltd", dir: "Arjun Malhotra", city: "Mumbai", gstPrefix: "27", msme: "No" },
  { name: "Unity Medical Supplies", dir: "Priya Deshmukh", city: "Nagpur", gstPrefix: "27", msme: "Yes" },
  { name: "Krishna Construction Co", dir: "Manoj Tiwari", city: "Lucknow", gstPrefix: "09", msme: "No" },
  { name: "Sunrise Office Equipments", dir: "Neha Kapoor", city: "Chandigarh", gstPrefix: "03", msme: "Yes" },
  { name: "Eastern Steel Corp", dir: "Debashish Roy", city: "Kolkata", gstPrefix: "19", msme: "No" },
  { name: "Green Valley Furnitures", dir: "Ramesh Pillai", city: "Bengaluru", gstPrefix: "29", msme: "Yes" },
  { name: "Prime Security Services", dir: "Farhan Sheikh", city: "Hyderabad", gstPrefix: "36", msme: "Yes" },
  { name: "National Stationery House", dir: "Sunita Verma", city: "Jaipur", gstPrefix: "08", msme: "Yes" },
];

let counter = 1009;
const independentBidders = independents.map((x, i) => {
  const id = `BID-${counter++}`;
  const codeBase = x.name.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase().padEnd(5, "X");
  return {
    bidder_id: id,
    company_name: x.name,
    director_name: x.dir,
    address: `${20 + i} Sector ${i + 1}, ${x.city}`,
    phone: `9${(600000000 + i * 1111117).toString().slice(0, 9)}`,
    email: `info@${x.name.toLowerCase().replace(/[^a-z]/g, "")}.example`,
    gst_number: `${x.gstPrefix}${codeBase}${1000 + i}${["A","B","C"][i % 3]}1Z${(i % 9) + 1}`,
    pan_number: `${codeBase}${1000 + i}${["A","B","C"][i % 3]}`,
    bank_account: `${700000000000 + i * 987654}`,
    msme_status: x.msme,
  };
});

const allBase = [...clusterA, ...clusterB, ...independentBidders];

// Known-collusive labels.
// label 1 = confirmed collusive in this synthetic scenario, 0 = known clean,
// undefined = unknown (the engine treats these as unlabelled and will still
// score them; withholding a couple of ring members shows whether the model
// recovers companies it was never told about).
const LABEL_ONE = ["BID-1001", "BID-1002", "BID-1003", "BID-1004"]; // ring, labelled
const LABEL_WITHHELD = ["BID-1005", "BID-1006"];                    // ring, unlabelled
function labelFor(bidderId) {
  if (LABEL_ONE.includes(bidderId)) return 1;
  if (LABEL_WITHHELD.includes(bidderId)) return undefined;
  if (bidderId.startsWith("BID-10") && Number(bidderId.slice(-4)) >= 1009) return 0;
  return undefined; // cluster B: unknown
}

// --- Deterministic RNG ---------------------------------------------------
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const rand = seededRandom(42);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function sample(arr, n) {
  const pool = arr.slice();
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}

const START = new Date("2026-06-01T00:00:00Z");
function dateAfter(days) {
  return new Date(START.getTime() + days * 86400000).toISOString().slice(0, 10);
}

const ringIds = [...clusterA.map((b) => b.bidder_id)];
const clusterBIds = clusterB.map((b) => b.bidder_id);
const independentIds = independentBidders.map((b) => b.bidder_id);

let bidCounter = 1001;
let tenderCounter = 2001;
const bids = [];

function emitTender({ bidderIds, winnerId, category, day, coverBids }) {
  const tenderId = `GEM/2026/T/${String(tenderCounter++).padStart(6, "0")}`;
  const base = Math.floor(400000 + rand() * 4000000);

  bidderIds.forEach((bidderId) => {
    let amount;
    if (bidderId === winnerId) {
      amount = base;
    } else if (coverBids) {
      // Cover bid: a losing price deliberately set just above the winner
      // (2%-8%), the classic footprint of a complementary bid.
      amount = Math.round(base * (1.02 + rand() * 0.06));
    } else {
      // Genuine competition: a wide, unstructured spread.
      amount = Math.round(base * (1.01 + rand() * 0.45));
    }
    bids.push({
      bid_id: `GEM/2026/B/${String(bidCounter++).padStart(6, "0")}`,
      tender_id: tenderId,
      bidder_id: bidderId,
      category,
      bid_amount: amount,
      submission_date: dateAfter(day),
      verification_status: null,
    });
  });
}

// --- Rigged tenders: the ring bids as a bloc and rotates the win ---------
const RING_TENDERS = 12;
for (let i = 0; i < RING_TENDERS; i++) {
  const participants = sample(ringIds, 4 + Math.floor(rand() * 2));
  // Rotation: the win moves evenly through the ring rather than being won
  // by whoever is genuinely cheapest.
  const winnerId = participants[i % participants.length];
  const outsiders = rand() < 0.5 ? sample(independentIds, 1) : [];
  emitTender({
    bidderIds: [...participants, ...outsiders],
    winnerId,
    category: pick(categories),
    day: i * 7 + Math.floor(rand() * 3),
    coverBids: true,
  });
}

// --- Cluster B: shares a bank account, but bids normally -----------------
for (let i = 0; i < 4; i++) {
  emitTender({
    bidderIds: [...clusterBIds, ...sample(independentIds, 2)],
    winnerId: rand() < 0.5 ? clusterBIds[0] : pick(independentIds),
    category: pick(categories),
    day: 10 + i * 9,
    coverBids: false,
  });
}

// --- Genuinely competitive tenders --------------------------------------
const COMPETITIVE_TENDERS = 22;
for (let i = 0; i < COMPETITIVE_TENDERS; i++) {
  const participants = sample(independentIds, 3 + Math.floor(rand() * 3));
  emitTender({
    bidderIds: participants,
    winnerId: pick(participants),
    category: pick(categories),
    day: i * 4 + Math.floor(rand() * 4),
    coverBids: false,
  });
}

// --- Attach bid refs + labels to bidders --------------------------------
const finalBidders = allBase.map((b) => {
  const own = bids.filter((x) => x.bidder_id === b.bidder_id);
  const label = labelFor(b.bidder_id);
  return {
    ...b,
    bids: own.map((x) => ({ bid_id: x.bid_id, category: x.category })),
    ...(label === undefined ? {} : { label }),
  };
});

// --- Verification status (an officer workflow state, not a risk signal) --
bids.forEach((bid) => {
  const r = rand();
  bid.verification_status = r < 0.25 ? "Needs Review" : r < 0.95 ? "Verified" : "Rejected";
});

fs.writeFileSync(path.join(__dirname, "data", "bidders.json"), JSON.stringify(finalBidders, null, 2));
fs.writeFileSync(path.join(__dirname, "data", "bids.json"), JSON.stringify(bids, null, 2));
fs.writeFileSync(path.join(__dirname, "data", "auditLog.json"), JSON.stringify([], null, 2));

const tenders = new Set(bids.map((b) => b.tender_id));
console.log(
  `Generated ${finalBidders.length} bidders, ${bids.length} bids across ${tenders.size} tenders ` +
    `(avg ${(bids.length / tenders.size).toFixed(1)} bidders per tender).`
);
console.log("Risk scores are NOT stored here - run the engine to produce them.");
