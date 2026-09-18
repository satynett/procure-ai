// gen-data.js
// One-off generator for realistic SYNTHETIC/SANDBOX GeM-style demo data.
// Run with: node gen-data.js
// Writes server/data/bidders.json and server/data/bids.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { computeBidderRiskMap } from "./utils/riskEngine.js";

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

// --- Generate bids for each bidder --------------------------------------
function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
const rand = seededRandom(42);

function randomDateWithinDays(daysBack) {
  const now = new Date("2026-09-16T00:00:00Z");
  const offset = Math.floor(rand() * daysBack);
  const d = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

let bidCounter = 1001;
const bids = [];

allBase.forEach((b) => {
  const numBids = 1 + Math.floor(rand() * 3); // 1-3 bids each
  const bidderBidRefs = [];
  for (let i = 0; i < numBids; i++) {
    const bidId = `GEM/2026/B/${String(bidCounter).padStart(6, "0")}`;
    bidCounter++;
    const category = categories[Math.floor(rand() * categories.length)];
    const amount = Math.floor(50000 + rand() * 4500000);
    const statusRoll = rand();
    const bidRecord = {
      bid_id: bidId,
      tender_id: `GEM/2026/T/${String(2000 + Math.floor(rand() * 900)).padStart(6, "0")}`,
      bidder_id: b.bidder_id,
      category,
      bid_amount: amount,
      submission_date: randomDateWithinDays(45),
      // verification_status assigned below once we know cluster risk
      verification_status: null,
    };
    bids.push(bidRecord);
    bidderBidRefs.push({ bid_id: bidId, category });
  }
  b.bids = bidderBidRefs;
});

// Compute relationship risk per bidder using the same engine the server uses
const riskMap = computeBidderRiskMap(allBase);

const finalBidders = allBase.map((b) => ({
  ...b,
  risk_score: riskMap[b.bidder_id].score,
  risk_category: riskMap[b.bidder_id].category,
  cluster_id: riskMap[b.bidder_id].cluster_id,
}));

// Assign verification status per bid, influenced by bidder risk + some independent randomness
bids.forEach((bidRecord) => {
  const bidder = finalBidders.find((x) => x.bidder_id === bidRecord.bidder_id);
  const r = rand();
  let status;
  if (bidder.risk_score >= 61) {
    status = r < 0.75 ? "Needs Review" : r < 0.92 ? "Verified" : "Rejected";
  } else if (bidder.risk_score >= 31) {
    status = r < 0.4 ? "Needs Review" : r < 0.95 ? "Verified" : "Rejected";
  } else {
    status = r < 0.08 ? "Needs Review" : r < 0.97 ? "Verified" : "Rejected";
  }
  // Per-bid risk score: bidder's relationship risk, blended lightly with noise for independents
  const noise = bidder.risk_score > 0 ? 0 : Math.floor(rand() * 22);
  bidRecord.risk_score = Math.min(100, bidder.risk_score > 0 ? bidder.risk_score : noise);
  bidRecord.verification_status = status;
});

fs.writeFileSync(
  path.join(__dirname, "data", "bidders.json"),
  JSON.stringify(finalBidders, null, 2)
);
fs.writeFileSync(path.join(__dirname, "data", "bids.json"), JSON.stringify(bids, null, 2));
fs.writeFileSync(path.join(__dirname, "data", "auditLog.json"), JSON.stringify([], null, 2));

console.log(`Generated ${finalBidders.length} bidders and ${bids.length} bids.`);
