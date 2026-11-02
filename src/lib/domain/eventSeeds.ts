// The starting list (SPEC §15.14), researched on 2026-11-02. datesConfirmed only where official or several
// independent sources agree. No date is guessed: unknown dates stay blank with a hint of when it last ran.
import type { EventItem } from "./events";

export type EventSeed = Pick<EventItem, "name" | "kind" | "tier" | "sector"> &
  Partial<Pick<EventItem, "organiser" | "city" | "startDate" | "endDate" | "dateNote" | "datesConfirmed" | "url" | "why">>;

export const EVENT_SEEDS: EventSeed[] = [
  // ─── Investors, founders and bankers ─────────────────────────────
  { name: "Dhando Valley", kind: "OWN", tier: "TOP", sector: "Multi-sector", organiser: "Niveshaay", dateNote: "Add the next date", why: "Our own event." },
  { name: "IVCA Conclave 2027", kind: "NETWORKING", tier: "TOP", sector: "Multi-sector", organiser: "IVCA", city: "Mumbai", dateNote: "Last held 10–11 Mar 2026", why: "India's main PE and VC industry gathering: GPs, LPs and advisers." },
  { name: "IVCA Bharat DeepTech Summit 2027", kind: "NETWORKING", tier: "WORTH_A_LOOK", sector: "Robotics and deep tech", organiser: "IVCA", dateNote: "Seen only on a partner form, no date yet", why: "Deep tech investors and founders in one room." },
  { name: "Equirus Annual India Conference 2027", kind: "BANKER", tier: "TOP", sector: "Multi-sector", organiser: "Equirus", city: "Mumbai", dateNote: "Last held 14 Aug 2026", why: "Banker-run investor conference with group and one-on-one meetings. Check how to get an invite." },
  { name: "VCCircle Family Office Summit 2027", kind: "FAMILY_OFFICE", tier: "TOP", sector: "Multi-sector", organiser: "VCCircle", city: "Mumbai", dateNote: "Last held in July 2026", why: "Single and multi-family offices and institutional allocators." },
  { name: "Indian Family Office Summit 2027", kind: "FAMILY_OFFICE", tier: "WORTH_A_LOOK", sector: "Multi-sector", organiser: "Equalifi", city: "Mumbai", dateNote: "2026 edition held in Mumbai, date not found", why: "Long-running family office forum." },
  { name: "TiE Global Summit 2026", kind: "NETWORKING", tier: "WORTH_A_LOOK", sector: "Multi-sector", organiser: "TiE", startDate: "2026-12-14", endDate: "2026-12-15", why: "Founders and investors. Listed on one calendar only, without a city." },
  { name: "TiECon Pune 2027", kind: "NETWORKING", tier: "WORTH_A_LOOK", sector: "Multi-sector", organiser: "TiE Pune", city: "Pune", startDate: "2027-02-05", endDate: "2027-02-06", url: "https://www.startupgrantsindia.com/events/tiecon-pune-2027", why: "Founder-heavy flagship of TiE Pune." },
  { name: "Startup Mahakumbh 2027", kind: "NETWORKING", tier: "WORTH_A_LOOK", sector: "Multi-sector", city: "New Delhi", startDate: "2027-03-12", endDate: "2027-03-14", why: "India's largest startup gathering. Listings disagree on the length and the venue." },

  // ─── Defence, aerospace and space ────────────────────────────────
  { name: "BDTS Strategic Colloquium, New Delhi", kind: "SECTOR_EXPO", tier: "TOP", sector: "Defence and aerospace", organiser: "Bharat Defence Tech Show", city: "New Delhi", startDate: "2026-12-10", datesConfirmed: true, url: "https://bharatdefencetechshow.com/colloquiums/", why: "Finale of the 2026 colloquium series, which included Bengaluru on 3 Sep. Invite only: partnerships@bharatdefencetechshow.com." },
  { name: "Aero India 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Defence and aerospace", organiser: "Ministry of Defence", city: "Bengaluru", startDate: "2027-02-08", endDate: "2027-02-12", datesConfirmed: true, url: "https://www.aeroindia.gov.in", why: "India's flagship aerospace and defence show. Relevant to Anadrone, JSR Dynamics and the space portfolio." },
  { name: "Bharat Defence Tech Show 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Defence and aerospace", organiser: "Bharat Defence Tech Show", city: "New Delhi", dateNote: "2026 edition was held in early 2026", url: "https://bharatdefencetechshow.com", why: "Defence tech founders and buyers." },
  { name: "DEF-TECH Bharat 2027", kind: "SECTOR_EXPO", tier: "WORTH_A_LOOK", sector: "Defence and aerospace", city: "Bengaluru", dateNote: "Last held 20–22 May 2026 at KTPO", why: "Defence tech expo in Bengaluru." },
  { name: "Bengaluru Space Expo 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Space", organiser: "CII with ISRO", city: "Bengaluru", dateNote: "Last held 7–9 Sep 2026 at BIEC", url: "https://bsxindia.com", why: "India's main space industry event. Relevant to Agnikul, Orbit Space and XDLinx." },

  // ─── Energy transition ───────────────────────────────────────────
  { name: "Intersolar India 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Renewables", city: "Gandhinagar", startDate: "2027-02-24", endDate: "2027-02-26", why: "Solar and storage. One listing only: confirm with the organiser." },
  { name: "India Energy Storage Week 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Batteries and storage", organiser: "India Energy Storage Alliance", city: "New Delhi", dateNote: "Last held 8–10 Jul 2026 at YashoBhoomi", why: "Storage and battery capital in one place. Relevant to MecPower and Navitas." },
  { name: "Renewable Energy India Expo 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Renewables", organiser: "Informa Markets", city: "Greater Noida", dateNote: "Last held 22–24 Oct 2026, alongside The Battery Show India", why: "India's largest renewables show. Relevant to the energy transition portfolio." },
  { name: "The Battery Show India 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Batteries and storage", organiser: "Informa Markets", startDate: "2027-10-26", endDate: "2027-10-28", url: "https://www.german-pavilion.com/en/the-battery-show-india-2027", why: "Battery and EV supply chain. The date comes from a German pavilion page, not the organiser." },

  // ─── Electronics, robotics and deep tech ─────────────────────────
  { name: "Bengaluru Tech Summit 2026", kind: "SECTOR_EXPO", tier: "TOP", sector: "Robotics and deep tech", organiser: "Government of Karnataka", city: "Bengaluru", startDate: "2026-11-17", endDate: "2026-11-19", datesConfirmed: true, why: "AI and robotics pavilion, deep tech founders and investors." },
  { name: "Automation Expo 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Robotics and deep tech", city: "Mumbai", startDate: "2027-06-02", endDate: "2027-06-05", datesConfirmed: true, url: "https://automationindiaexpo.com", why: "Largest industrial automation and robotics show in the region." },
  { name: "SEMICON India 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Semiconductors and electronics", city: "New Delhi", startDate: "2027-09-14", endDate: "2027-09-16", url: "https://silicon-saxony.de/sisax-events/semicon-india-2027-silicon-saxony-gemeinschaftsstand/", why: "Main chip event in India. Relevant to Suchi Semicon and Ekkaa. Dates are provisional." },

  // ─── Mobility, logistics, water, recycling, fintech ──────────────
  { name: "Bharat Mobility Global Expo 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Mobility and auto components", organiser: "EEPC India", city: "New Delhi", startDate: "2027-02-04", endDate: "2027-02-09", datesConfirmed: true, url: "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2141842&reg=48&lang=2", why: "Includes the Auto Expo Components Show. Relevant to SKS Fasteners and EV deals." },
  { name: "LogiMAT India 2027", kind: "SECTOR_EXPO", tier: "WORTH_A_LOOK", sector: "Logistics", organiser: "Messe Stuttgart India", city: "Mumbai", startDate: "2027-02-08", endDate: "2027-02-10", datesConfirmed: true, url: "https://www.german-pavilion.com/en/logimat-india", why: "Warehousing and logistics. Relevant to Momentum. Clashes with Aero India." },
  { name: "India Warehousing Show 2027", kind: "SECTOR_EXPO", tier: "WORTH_A_LOOK", sector: "Logistics", city: "New Delhi", startDate: "2027-06-24", endDate: "2027-06-26", why: "Warehousing and supply chain. One listing only." },
  { name: "Water and CleanTech India Expo 2027", kind: "SECTOR_EXPO", tier: "WORTH_A_LOOK", sector: "Water", startDate: "2027-03-23", endDate: "2027-03-25", why: "Water infrastructure. Relevant to Cimcon and Eiffil Water. Listings disagree on the city." },
  { name: "IFAT India 2027", kind: "SECTOR_EXPO", tier: "TOP", sector: "Water", organiser: "Messe München India", dateNote: "Listings conflict: Apr 2027 in Delhi or Sep–Oct 2027 in Mumbai", why: "Leading water, waste and recycling trade show. Relevant to Cimcon, Eiffil Water, Regain and SriChakra." },
  { name: "World of Recycling Expo 2027", kind: "SECTOR_EXPO", tier: "WORTH_A_LOOK", sector: "Recycling", city: "Greater Noida", dateNote: "Listed for 2027 without dates", why: "Relevant to Regain and SriChakra." },
  { name: "Global Fintech Fest 2027", kind: "SECTOR_EXPO", tier: "WORTH_A_LOOK", sector: "Fintech", city: "Mumbai", dateNote: "Last held 9–11 Sep 2026", url: "https://www.globalfintechfest.com", why: "Largest fintech event in India. Relevant to Smallcase and Solfin." },
];
