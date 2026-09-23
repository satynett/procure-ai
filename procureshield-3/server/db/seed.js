// Clean synthetic Indian procurement dataset for the SIH prototype.
// All identities, registration numbers, contacts and bid values are fictional.

const cities = [
  ["New Delhi","Delhi","07"],["Bengaluru","Karnataka","29"],["Hyderabad","Telangana","36"],
  ["Pune","Maharashtra","27"],["Jaipur","Rajasthan","08"],["Lucknow","Uttar Pradesh","09"],
  ["Ahmedabad","Gujarat","24"],["Chennai","Tamil Nadu","33"],["Kolkata","West Bengal","19"],
  ["Raipur","Chhattisgarh","22"],["Bhopal","Madhya Pradesh","23"],["Bhubaneswar","Odisha","21"],
  ["Kochi","Kerala","32"],["Patna","Bihar","10"],["Chandigarh","Chandigarh","04"],
  ["Nagpur","Maharashtra","27"],["Indore","Madhya Pradesh","23"],["Guwahati","Assam","18"],
];

const companies = [
  ["Aarav Digital Systems Pvt. Ltd.","Amit Verma"],["Bharat Secure Technologies Pvt. Ltd.","Nikhil Mehta"],
  ["Shree Ganesh Electricals","Rakesh Sharma"],["Triveni Medical Solutions Pvt. Ltd.","Pooja Iyer"],
  ["Vardhan Infotech Services Pvt. Ltd.","Karan Malhotra"],["Sahyadri Office Systems Pvt. Ltd.","Sneha Patil"],
  ["Kaveri Engineering Works","Vivek Rao"],["Navya Healthcare Devices Pvt. Ltd.","Ananya Menon"],
  ["Aravali Infrastructure Solutions","Mohit Singh"],["Mahanadi Procurement Services","Ritu Sahu"],
  ["Vindhya Technologies Pvt. Ltd.","Aditya Tiwari"],["Eastern India Safety Systems","Debashis Roy"],
  ["Deccan Facility Solutions","Farhan Khan"],["Saral Office Automation Pvt. Ltd.","Neha Kapoor"],
  ["Ujjwal Industrial Supplies","Manoj Jain"],["Narmada Projects & Engineering","Priya Deshmukh"],
  ["Nilgiri Systems & Services","Arjun Nair"],["Brahmaputra Supply Co.","Kavita Das"],
];

const bidders = companies.map(([company_name, director_name], i) => {
  const [city,state,stateCode] = cities[i];
  const id = "BID-" + String(2001+i).padStart(4,"0");
  const panRoot = ["AARAV","BHART","SHREE","TRIVE","VARDH","SAHYA","KAVER","NAVYA","ARAVA","MAHAN","VINDH","EASTE","DECCA","SARAL","UJJW","NARMA","NILGI","BRAHM"][i];
  return {
    bidder_id:id, company_name, director_name,
    address:(12+i) + ", Industrial Area, " + city + ", " + state,
    phone:"98" + String(41000000+i*137).padStart(8,"0"),
    email:"procurement@" + company_name.toLowerCase().replace(/[^a-z0-9]+/g,"").slice(0,18) + ".example",
    gst_number:stateCode + panRoot.slice(0,5) + String(1000+i).padStart(4,"0") + "A1Z" + ((i%9)+1),
    pan_number:panRoot.slice(0,5) + String(1000+i).padStart(4,"0"),
    bank_account:"6210" + String(450000000+i*7913).padStart(9,"0"),
    msme_status:i%3===0||i%3===1?"Yes":"No",
    bids:[],
    label:i<4?1:0,
  };
});

// Deliberate synthetic relationships for graph demonstration.
// These are fictional and should never be treated as real-world findings.
bidders[1].director_name = bidders[0].director_name;
bidders[2].address = bidders[0].address;
bidders[3].address = bidders[0].address;
bidders[1].phone = bidders[0].phone;
bidders[2].bank_account = bidders[0].bank_account;

const tenderTemplates = [
  ["Network Security Equipment & Installation","Department of Information Technology","IT Hardware",5200000],
  ["District Hospital Patient Monitoring Equipment","State Health Services Department","Medical Equipment",6800000],
  ["Electrical Upgrade for Government Offices","Public Works Department","Electrical Goods",4100000],
  ["Smart Classroom Computing Equipment","Department of School Education","IT Hardware",3600000],
  ["Municipal CCTV & Control Room Equipment","Municipal Administration Department","Security Equipment",4700000],
  ["Police Communication & Surveillance Equipment","State Police Procurement Cell","Security Equipment",5900000],
  ["Rural Road Safety & Electrical Materials","Rural Development Department","Construction Materials",3300000],
  ["Government Data Centre Networking Equipment","Department of Information Technology","IT Hardware",7400000],
  ["District Hospital Laboratory Equipment","State Health Services Department","Medical Equipment",4300000],
  ["Solar Backup Systems for Public Buildings","Public Works Department","Electrical Goods",5100000],
  ["Office Digitisation Hardware","Department of School Education","IT Hardware",2900000],
  ["Urban Water Monitoring Devices","Municipal Administration Department","Civic Equipment",2700000],
  ["Emergency Response Communication Kits","State Police Procurement Cell","Security Equipment",3800000],
  ["Primary Health Centre Equipment Lot","State Health Services Department","Medical Equipment",3100000],
  ["Government Office Electrical Maintenance","Public Works Department","Electrical Goods",2200000],
  ["District e-Governance Hardware","Department of Information Technology","IT Hardware",4600000],
  ["Community Infrastructure Materials","Rural Development Department","Construction Materials",3500000],
];

const requiredDocs = ["GST certificate","PAN card","Udyam/MSME certificate","Experience certificate","Financial statement","OEM authorization","EMD proof"];

function rfpFor(title, value) {
  return [
    "Tender: " + title,
    "Minimum 3 years relevant experience.",
    "Average annual turnover of at least ₹" + Math.round(value/100000/5)*5 + " lakh.",
    "Valid GST and PAN registration required.",
    "Eligible MSMEs may participate subject to tender conditions.",
    "OEM authorization required where applicable.",
    "Bid validity: 90 days. Delivery as specified in the tender schedule.",
    "Bidder must submit the prescribed EMD and all supporting documents.",
  ].join("\\n");
}

const tenders = tenderTemplates.map(([title,department,category,estimated_value],i)=>{
  const open=i<5;
  const closed=i>=5 && i<7;
  const day=String(8+i*2).padStart(2,"0");
  const tender_id="GEM/2026/T/" + String(4100+i).padStart(4,"0");
  const deadline="2026-1" + (i<4?"0":"1") + "-" + day;
  const rfpText=rfpFor(title,estimated_value);
  const tender={
    tender_id,title,department,category,
    status:open?"Open":closed?"Closed":"Awarded",
    deadline,estimated_value,
    rfp_filename:tender_id.replaceAll("/","_") + "_RFP.pdf",
    rfp_text:rfpText,
    rfp_content_base64:Buffer.from(rfpText,"utf8").toString("base64"),
    eligibility_summary:"Relevant experience, valid GST/PAN, financial capacity, required statutory registrations and tender-specific technical eligibility.",
    eligibility_requirements:["Minimum 3 years relevant experience","Valid GST registration","Valid PAN","Minimum turnover as stated in RFP"],
    technical_requirements:["Supply and installation of " + category.toLowerCase() + " as per RFP","OEM/manufacturer authorization where applicable","Compliance with tender specifications"],
    required_documents:requiredDocs,
    important_dates:["Bid deadline: " + deadline,"Bid validity: 90 days"],
    created_at:"2026-05-" + String(10+i).padStart(2,"0") + "T09:00:00.000Z",
    published_at:"2026-05-" + String(10+i).padStart(2,"0") + "T10:00:00.000Z",
  };
  if(!open) tender.closing_date="2026-07-" + String(5+i).padStart(2,"0");
  if(tender.status==="Awarded") tender.award_date="2026-07-" + String(19+i).padStart(2,"0");
  return tender;
});

const bids=[];
let seq=1;
for (const [ti,tender] of tenders.entries()) {
  const start = ti<7 ? 0 : (ti*3)%bidders.length;
  const selected=[0,1,2,3].map(x=>(start+x)%bidders.length);
  [...new Set(selected)].forEach((bi,rank)=>{
    const bidder=bidders[bi];
    const variation=1 + ((bi*7 + ti*3 + rank)%13)/100;
    const amount=Math.round((tender.estimated_value*0.86*variation)/1000)*1000;
    const bid={
      bid_id:"GEM/2026/B/" + String(5100+seq).padStart(4,"0"),
      tender_id:tender.tender_id, bidder_id:bidder.bidder_id,
      bidder_company_name:bidder.company_name, category:tender.category,
      bid_amount:amount,
      submission_date:"2026-0" + (6+Math.floor(ti/5)) + "-" + String(10+(ti%12)).padStart(2,"0"),
      verification_status:tender.status==="Awarded" ? (bi%5===0?"Needs Review":"Verified") : "Needs Review",
      submitted_documents:requiredDocs,
    };
    bids.push(bid);
    bidder.bids.push({bid_id:bid.bid_id,category:bid.category});
    seq++;
  });
  if(tender.status==="Awarded"){
    const tenderBids=bids.filter(b=>b.tender_id===tender.tender_id);
    const winner=tenderBids.slice().sort((a,b)=>a.bid_amount-b.bid_amount)[0];
    tender.winner_bid_id=winner.bid_id;
    tender.award_amount=winner.bid_amount;
  }
}

export const seedData={bidders,tenders,bids,auditLog:[
  {id:"AUD-SEED-001",officer:"Procurement Officer 01",action:"Seeded Indian synthetic procurement dataset",timestamp:"2026-08-01T09:00:00.000Z"},
]};
