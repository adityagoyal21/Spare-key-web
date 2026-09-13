import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  LayoutDashboard, NotebookPen, CalendarDays, IndianRupee, Plus, Trash2, Pencil,
  ChevronLeft, ChevronRight, X, Check, Phone, Users, Tag, Home, Upload, Download, Wallet,
} from "lucide-react";
import { supabase, supabaseConfigured } from "./supabaseClient";

const FONT_IMPORT = `@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&display=swap');`;

const INK = "#1E2A44";
const INK_SOFT = "#2C3B5E";
const PAPER = "#FAF6EE";
const PAPER_DIM = "#F1EAD9";
const MUSTARD = "#C98A1F";
const MUSTARD_DEEP = "#A66E12";
const LINE = "#E4DAC4";
const TEXT_MUTED = "#6B7280";

const DEFAULT_PROPERTIES = ["Whimsy Suite"];
const PROPERTY_COLORS = ["#B6473F", "#2F6F8F", "#3F6B4E", "#8A5FA6", "#B8862E", "#4A6670"];
const DIRECT_PAYMENT_MODES = ["UPI", "Cash", "Bank Transfer", "Card", "Other"];
const SOURCES = ["Airbnb", "Direct", "Referral", "Other"];
const EXPENSE_CATEGORIES = ["Utilities", "Maintenance", "Cleaning", "Staff", "Supplies", "Subscription", "Platform fees", "Other"];

function propertyColor(properties, name) {
  const idx = properties.indexOf(name);
  return PROPERTY_COLORS[idx >= 0 ? idx % PROPERTY_COLORS.length : 0];
}
// Handles the current shape (guest-paid vs. host-payout split for Airbnb, plus a direct amount),
// and falls back gracefully for records saved before that split existed.
function paymentBreakdown(b) {
  if (b.guestPaidAirbnb !== undefined || b.airbnbPayout !== undefined) {
    return {
      guestPaidAirbnb: Number(b.guestPaidAirbnb) || 0,
      airbnbPayout: Number(b.airbnbPayout) || 0,
      direct: Number(b.amountDirect) || 0,
      directMode: b.directMode || "UPI",
    };
  }
  if (b.amountAirbnb !== undefined || b.amountDirect !== undefined) {
    const amt = Number(b.amountAirbnb) || 0;
    return { guestPaidAirbnb: amt, airbnbPayout: amt, direct: Number(b.amountDirect) || 0, directMode: b.directMode || "UPI" };
  }
  const amt = Number(b.amountPaid) || 0;
  if (b.paymentMode === "Airbnb Payout") return { guestPaidAirbnb: amt, airbnbPayout: amt, direct: 0, directMode: "UPI" };
  return { guestPaidAirbnb: 0, airbnbPayout: 0, direct: amt, directMode: b.paymentMode || "UPI" };
}
// Total amount is always derived — guest paid via Airbnb plus whatever was paid directly —
// rather than entered separately, so it can never drift out of sync with the two real figures.
function totalFromParts(guestPaidAirbnb, amountDirect) {
  return (Number(guestPaidAirbnb) || 0) + (Number(amountDirect) || 0);
}
// What actually lands in the host's pocket — Airbnb payout (post fees/taxes) plus direct payments.
function hostEarnings(b) {
  const { airbnbPayout, direct } = paymentBreakdown(b);
  return airbnbPayout + direct;
}
// Airbnb releases its payout only after the guest checks in — before that date, that portion
// hasn't actually landed yet, so the Dashboard's "collected" figure should exclude it (and its
// "outstanding" figure should include it) until then. Direct payments are assumed already in
// hand whenever they're recorded, regardless of check-in timing.
function collectedEarnings(b, today) {
  const { airbnbPayout, direct } = paymentBreakdown(b);
  return (b.checkIn <= today ? airbnbPayout : 0) + direct;
}
function pendingAirbnbPayout(b, today) {
  const { airbnbPayout } = paymentBreakdown(b);
  return b.checkIn > today ? airbnbPayout : 0;
}
function inr(n) {
  const v = Number(n) || 0;
  // Promotional bookings can carry a negative direct-payment amount (a discount applied as
  // credit) — put the minus sign before the ₹ symbol ("-₹500") instead of after it ("₹-500").
  return (v < 0 ? "-₹" : "₹") + Math.abs(v).toLocaleString("en-IN");
}
function pad2(n) { return String(n).padStart(2, "0"); }
// Builds a YYYY-MM-DD string from local date parts — never round-trips through toISOString(),
// which renders in UTC and silently shifts the date back a day for timezones ahead of UTC
// (e.g. India, UTC+5:30). That mismatch was making guests appear on the wrong calendar cell.
function ymdToISO(year, month0, day) { return `${year}-${pad2(month0 + 1)}-${pad2(day)}`; }
function todayStr() {
  const d = new Date();
  return ymdToISO(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return ymdToISO(d.getFullYear(), d.getMonth(), d.getDate());
}
// The current moment in IST (UTC+5:30), regardless of the viewer's own device timezone — the
// Dashboard's "next checkout" needs to agree on the same clock whether staff are checking it
// from the property or from elsewhere.
// Date.now() is an absolute instant (not affected by the device's own timezone), so shifting it
// by IST's fixed +5:30 offset and reading it back with the UTC getters — never the local
// getFullYear()/getHours(), which would re-apply the device's own offset on top — gives IST wall
// time correctly no matter what timezone the viewer's device is set to.
function nowIST() {
  return new Date(Date.now() + 5.5 * 60 * 60000);
}
function todayStrIST() {
  const d = nowIST();
  return ymdToISO(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
// Guests are expected out by noon — once past that, treat today's checkout as already having
// happened rather than "upcoming", so the Dashboard doesn't keep pointing at a guest who's left.
function isPastCheckoutTimeIST() {
  return nowIST().getUTCHours() >= 12;
}
// Guests are expected to have checked in by 1 PM — once past that, treat today's check-in as
// already done, so the Dashboard's "next check-in" moves on to whoever's actually still upcoming.
function isPastCheckinTimeIST() {
  return nowIST().getUTCHours() >= 13;
}
function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
// Walks every night of a stay and buckets it by the calendar month it falls in, so a booking
// that spans a month boundary (e.g. checks in Aug 30, checks out Sep 3) can have its revenue
// split proportionally rather than dumped entirely into the check-in month.
function nightsByMonth(checkIn, checkOut) {
  const result = {};
  if (!checkIn || !checkOut) return result;
  let cur = new Date(checkIn + "T00:00:00");
  const end = new Date(checkOut + "T00:00:00");
  let guard = 0;
  while (cur < end && guard < 730) {
    const key = `${cur.getFullYear()}-${cur.getMonth()}`;
    result[key] = (result[key] || 0) + 1;
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return result;
}
function monthLabel(d) {
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}
// Same "YYYY-M" key shape used throughout (nightsByMonth, RevenueTab's monthly buckets), built
// from a date string instead of walking nights — used to place fixed/one-time expenses in months.
function monthKeyOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${d.getMonth()}`;
}
// A fixed expense recurs every month from start_date through end_date (inclusive), or indefinitely
// if end_date is null. Compares by month key so a start/end date's day-of-month is irrelevant.
function fixedExpenseAppliesToMonthKey(exp, monthKey) {
  if (!exp.startDate) return false;
  const [y, m] = monthKey.split("-").map(Number);
  const monthStart = new Date(y, m, 1);
  const start = new Date(exp.startDate + "T00:00:00");
  if (monthStart < new Date(start.getFullYear(), start.getMonth(), 1)) return false;
  if (exp.endDate) {
    const end = new Date(exp.endDate + "T00:00:00");
    if (monthStart > new Date(end.getFullYear(), end.getMonth(), 1)) return false;
  }
  return true;
}
function expensesForMonthKey(expenses, monthKey) {
  return expenses.reduce((sum, exp) => {
    if (exp.kind === "fixed") return sum + (fixedExpenseAppliesToMonthKey(exp, monthKey) ? Number(exp.amount) || 0 : 0);
    return sum + (exp.expenseDate && monthKeyOf(exp.expenseDate) === monthKey ? Number(exp.amount) || 0 : 0);
  }, 0);
}
// Whole calendar months from start through end, inclusive of both — used to cost out a fixed
// expense's full lifetime rather than just the currently-visible 12-month chart window.
function monthsBetweenInclusive(startDate, endDate) {
  const s = new Date(startDate + "T00:00:00");
  const e = new Date(endDate + "T00:00:00");
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1);
}
// True all-time total: every one-time expense ever logged, plus every fixed expense's amount
// multiplied by however many months it's actually been (or will have been) active.
function expenseAllTimeAmount(exp) {
  if (exp.kind === "fixed") {
    if (!exp.startDate) return 0;
    return (Number(exp.amount) || 0) * monthsBetweenInclusive(exp.startDate, exp.endDate || todayStr());
  }
  return Number(exp.amount) || 0;
}
function totalExpensesAllTime(expenses) {
  return expenses.reduce((sum, exp) => sum + expenseAllTimeAmount(exp), 0);
}
// Groups a list of {category, amount} items (or full expense records, which have both) by
// category — used as-is for a single month's line items, and fed expenseAllTimeAmount-expanded
// entries for an all-time view so a fixed expense counts every month it's actually been active.
function expensesByCategory(items) {
  const map = {};
  items.forEach((item) => {
    const cat = item.category || "Other";
    map[cat] = (map[cat] || 0) + (Number(item.amount) || 0);
  });
  return Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
}
function expenseDetailLine(e) {
  return e.kind === "fixed"
    ? `${inr(e.amount)}/mo · from ${e.startDate}${e.endDate ? ` to ${e.endDate}` : " · ongoing"}`
    : `${inr(e.amount)} · ${e.expenseDate}`;
}
function emptyExpenseForm() {
  return {
    id: null, kind: "one_time", name: "", category: EXPENSE_CATEGORIES[0], amount: "",
    property: "", expenseDate: todayStr(), startDate: todayStr(), endDate: "",
    notes: "", createdBy: "", updatedBy: "",
  };
}
function emptyForm() {
  return {
    id: null, guest: "", phone: "", property: "", checkIn: todayStr(),
    checkOut: addDays(todayStr(), 1), guests: 1, totalAmount: "",
    guestPaidAirbnb: "", airbnbPayout: "", amountDirect: "", directMode: "UPI", dueAmount: "",
    source: "Airbnb", createdBy: "", updatedBy: "", notes: "", cancelled: false,
  };
}

function toISODate(mmddyyyy) {
  const parts = (mmddyyyy || "").trim().split("/");
  if (parts.length !== 3) return "";
  const [mm, dd, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}
function parseCSVLine(line) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
// Parses Airbnb's "All-time" transaction/earnings CSV export. Reservation rows show the
// pre-fee amount; Tax Withholding / adjustment rows for the same Confirmation Code adjust it
// down to the real payout, so amounts are summed per Confirmation Code rather than read off
// a single row.
// Parses Airbnb's transaction/earnings CSV export (works for both the "completed" and "upcoming"
// exports \u2014 their headers differ slightly, e.g. "upcoming" lacks an "Arriving by date" column, but
// every field below is looked up by name so column position doesn't matter). Only "Reservation"
// rows carry the numbers we need; "Payout" rows (bank transfers) and "Tax Withholding for India
// Income" rows (a minor TDS deduction, deliberately ignored here) are skipped entirely.
// - Guest paid on Airbnb = Gross earnings + Airbnb remitted tax (the GST Airbnb collects from the
//   guest and remits directly \u2014 "Gross earnings" alone omits it).
// - Your payout = Amount, as-is (the real bank deposit is a few rupees less, after the ignored
//   income-tax withholding, but that gap is negligible for this purpose).
function parseAirbnbCSV(text, existingProperties) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { bookings: [], newProperties: [] };
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const iType = idx("Type"), iConf = idx("Confirmation Code"), iStart = idx("Start date"),
    iEnd = idx("End date"), iGuest = idx("Guest"), iListing = idx("Listing"),
    iAmount = idx("Amount"), iGross = idx("Gross earnings"), iTax = idx("Airbnb remitted tax");

  const newProperties = [];
  const seen = new Set();
  const bookings = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if ((row[iType] || "").trim() !== "Reservation") continue;
    const code = (row[iConf] || "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const amount = parseFloat(row[iAmount]) || 0;
    const grossEarnings = parseFloat(row[iGross]) || 0;
    const airbnbTax = parseFloat(row[iTax]) || 0;
    const guestPaidAirbnb = grossEarnings + airbnbTax;
    const airbnbPayout = amount;

    const listing = row[iListing] || "";
    let property = existingProperties.find((p) => listing.includes(p));
    if (!property) {
      property = (listing.split("|")[0] || listing).trim();
      if (property && !existingProperties.includes(property) && !newProperties.includes(property)) {
        newProperties.push(property);
      }
    }

    bookings.push({
      ...emptyForm(),
      id: "import-" + code,
      importRef: code,
      guest: row[iGuest] || "",
      property,
      checkIn: toISODate(row[iStart]),
      checkOut: toISODate(row[iEnd]),
      guests: 2, // the Airbnb export carries no guest-count column, so default to a typical stay
      totalAmount: totalFromParts(guestPaidAirbnb, 0) || "",
      guestPaidAirbnb: guestPaidAirbnb || "",
      airbnbPayout: airbnbPayout || "",
      amountDirect: "",
      source: "Airbnb",
      notes: `Imported from Airbnb (confirmation ${code})`,
    });
  }

  return { bookings: bookings.filter((b) => b.guest && b.checkIn), newProperties };
}

// Parses Stay Ledger's own "Download backup CSV" format (not Airbnb's) — used to merge data
// captured on one device/session into another. Matches existing records by guest+property+dates
// and updates them in place; anything not matched is added as new. Nothing is ever deleted by
// this — if a booking's missing from the file, it's left alone.
function parseBackupCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]).map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const cols = {
    guest: idx("Guest Name"), phone: idx("Phone"), property: idx("Property"),
    checkIn: idx("Check-in"), checkOut: idx("Check-out"), guests: idx("Guests"),
    totalAmount: idx("Total Amount"), guestPaidAirbnb: idx("Guest Paid via Airbnb"),
    airbnbPayout: idx("Your Airbnb Payout"), amountDirect: idx("Paid Directly"),
    directMode: idx("Direct Payment Mode"), dueAmount: idx("Amount Due"),
    source: idx("Source"), createdBy: idx("Created By"),
    updatedBy: idx("Updated By"), notes: idx("Notes"), cancelled: idx("Cancelled"),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    if (!row[cols.guest]) continue;
    rows.push({
      ...emptyForm(),
      guest: row[cols.guest] || "",
      phone: row[cols.phone] || "",
      property: row[cols.property] || "",
      checkIn: row[cols.checkIn] || "",
      checkOut: row[cols.checkOut] || "",
      guests: row[cols.guests] || "",
      totalAmount: row[cols.totalAmount] || "",
      guestPaidAirbnb: row[cols.guestPaidAirbnb] || "",
      airbnbPayout: row[cols.airbnbPayout] || "",
      amountDirect: row[cols.amountDirect] || "",
      directMode: row[cols.directMode] || "UPI",
      dueAmount: row[cols.dueAmount] || "",
      source: row[cols.source] || "Other",
      createdBy: row[cols.createdBy] || "",
      updatedBy: row[cols.updatedBy] || "",
      notes: row[cols.notes] || "",
      cancelled: (row[cols.cancelled] || "").trim().toUpperCase() === "Y",
    });
  }
  return rows;
}
function bookingNaturalKey(b) {
  return `${(b.guest || "").trim().toLowerCase()}|${(b.property || "").trim().toLowerCase()}|${b.checkIn}|${b.checkOut}`;
}

// --- Supabase row <-> app-shape mapping ---------------------------------------------------
// The app's fields are camelCase; Postgres columns are snake_case. These two functions are the
// only place that boundary is crossed, so every other component keeps working unmodified.
function rowToBooking(r) {
  return {
    id: r.id,
    importRef: r.import_ref || null,
    guest: r.guest || "",
    phone: r.phone || "",
    property: r.property || "",
    checkIn: r.check_in || "",
    checkOut: r.check_out || "",
    guests: r.guests ?? "",
    totalAmount: r.total_amount ?? "",
    guestPaidAirbnb: r.guest_paid_airbnb ?? "",
    airbnbPayout: r.airbnb_payout ?? "",
    amountDirect: r.amount_direct ?? "",
    directMode: r.direct_mode || "UPI",
    dueAmount: r.due_amount ?? "",
    source: r.source || "Airbnb",
    createdBy: r.created_by || "",
    updatedBy: r.updated_by || "",
    notes: r.notes || "",
    cancelled: !!r.cancelled,
  };
}
function bookingToRow(b) {
  const num = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
  return {
    id: b.id,
    import_ref: b.importRef || null,
    guest: b.guest || "",
    phone: b.phone || "",
    property: b.property || "",
    check_in: b.checkIn || null,
    check_out: b.checkOut || null,
    guests: num(b.guests),
    total_amount: num(b.totalAmount),
    guest_paid_airbnb: num(b.guestPaidAirbnb),
    airbnb_payout: num(b.airbnbPayout),
    amount_direct: num(b.amountDirect),
    direct_mode: b.directMode || null,
    due_amount: num(b.dueAmount),
    source: b.source || null,
    created_by: b.createdBy || null,
    updated_by: b.updatedBy || null,
    notes: b.notes || null,
    cancelled: !!b.cancelled,
  };
}

function rowToExpense(r) {
  return {
    id: r.id,
    kind: r.kind || "one_time",
    name: r.name || "",
    category: r.category || EXPENSE_CATEGORIES[0],
    amount: r.amount ?? "",
    property: r.property || "",
    expenseDate: r.expense_date || "",
    startDate: r.start_date || "",
    endDate: r.end_date || "",
    notes: r.notes || "",
    createdBy: r.created_by || "",
    updatedBy: r.updated_by || "",
  };
}
function expenseToRow(e) {
  const num = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
  return {
    id: e.id,
    kind: e.kind || "one_time",
    name: e.name || "",
    category: e.category || null,
    amount: num(e.amount) || 0,
    property: e.property || null,
    expense_date: e.kind === "one_time" ? (e.expenseDate || null) : null,
    start_date: e.kind === "fixed" ? (e.startDate || null) : null,
    end_date: e.kind === "fixed" ? (e.endDate || null) : null,
    notes: e.notes || null,
    created_by: e.createdBy || null,
    updated_by: e.updatedBy || null,
  };
}

function useStorage() {
  const [bookings, setBookings] = useState([]);
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES);
  const [expenses, setExpenses] = useState([]);
  const [startingBankBalance, setStartingBankBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data: bRows, error: bErr } = await supabase
          .from("bookings").select("*").order("check_in", { ascending: false });
        if (bErr) throw bErr;
        const { data: pRows, error: pErr } = await supabase
          .from("properties").select("*").order("name");
        if (pErr) throw pErr;
        const { data: eRows, error: eErr } = await supabase
          .from("expenses").select("*").order("created_at", { ascending: false });
        if (eErr) throw eErr;

        setBookings((bRows || []).map(rowToBooking));
        setProperties((pRows || []).length ? pRows.map((r) => r.name) : DEFAULT_PROPERTIES);
        setExpenses((eRows || []).map(rowToExpense));

        // Isolated from the try/catch above on purpose — app_settings is a newer, optional table
        // (e.g. its migration might not have been run yet), and its absence or failure shouldn't
        // be able to cascade into bookings/properties/expenses never getting loaded.
        try {
          const { data: sRows, error: sErr } = await supabase
            .from("app_settings").select("*").eq("id", "default").limit(1);
          if (sErr) throw sErr;
          setStartingBankBalance((sRows || [])[0]?.starting_bank_balance ?? 0);
        } catch (settingsErr) {
          console.error("Could not load app_settings (starting bank balance defaults to 0):", settingsErr);
        }
      } catch (e) {
        console.error(e);
        setError("Could not load saved data — check your Supabase connection.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Accepts the *next full array* (matching how every call site already works) and diffs it
  // against current state to issue the minimal set of upserts/deletes against Postgres.
  const persistBookings = useCallback(async (next) => {
    const prevIds = new Set(bookings.map((b) => b.id));
    const nextIds = new Set(next.map((b) => b.id));
    const removedIds = [...prevIds].filter((id) => !nextIds.has(id));
    setBookings(next);
    try {
      if (next.length) {
        const rows = next.map(bookingToRow);
        const { error: upErr } = await supabase.from("bookings").upsert(rows, { onConflict: "id" });
        if (upErr) throw upErr;
      }
      if (removedIds.length) {
        const { error: delErr } = await supabase.from("bookings").delete().in("id", removedIds);
        if (delErr) throw delErr;
      }
      setError("");
    } catch (e) {
      console.error(e);
      setError("Save failed — changes may not persist. Check your Supabase connection.");
    }
  }, [bookings]);

  const persistProperties = useCallback(async (next) => {
    const prevSet = new Set(properties);
    const nextSet = new Set(next);
    const added = next.filter((p) => !prevSet.has(p));
    const removed = properties.filter((p) => !nextSet.has(p));
    setProperties(next);
    try {
      if (added.length) {
        const { error: upErr } = await supabase.from("properties").upsert(added.map((name) => ({ name })), { onConflict: "name" });
        if (upErr) throw upErr;
      }
      if (removed.length) {
        const { error: delErr } = await supabase.from("properties").delete().in("name", removed);
        if (delErr) throw delErr;
      }
    } catch (e) {
      console.error(e);
    }
  }, [properties]);

  const persistExpenses = useCallback(async (next) => {
    const prevIds = new Set(expenses.map((e) => e.id));
    const nextIds = new Set(next.map((e) => e.id));
    const removedIds = [...prevIds].filter((id) => !nextIds.has(id));
    setExpenses(next);
    try {
      if (next.length) {
        const rows = next.map(expenseToRow);
        const { error: upErr } = await supabase.from("expenses").upsert(rows, { onConflict: "id" });
        if (upErr) throw upErr;
      }
      if (removedIds.length) {
        const { error: delErr } = await supabase.from("expenses").delete().in("id", removedIds);
        if (delErr) throw delErr;
      }
      setError("");
    } catch (e) {
      console.error(e);
      setError("Save failed — changes may not persist. Check your Supabase connection.");
    }
  }, [expenses]);

  const persistStartingBankBalance = useCallback(async (next) => {
    setStartingBankBalance(next);
    try {
      const { error: upErr } = await supabase
        .from("app_settings")
        .upsert({ id: "default", starting_bank_balance: next }, { onConflict: "id" });
      if (upErr) throw upErr;
      setError("");
    } catch (e) {
      console.error(e);
      setError("Save failed — changes may not persist. Check your Supabase connection.");
    }
  }, []);

  return {
    bookings, properties, expenses, startingBankBalance, loading, error,
    persistBookings, persistProperties, persistExpenses, persistStartingBankBalance,
  };
}

// A brief, self-dismissing confirmation banner (e.g. "Booking added successfully") — the kind of
// feedback that reassures a user an action actually saved, without requiring a click to close.
function useToast() {
  const [toast, setToast] = useState(null);
  const timeoutRef = useRef(null);
  const showToast = useCallback((message, tone = "success") => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, tone });
    timeoutRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  useEffect(() => () => timeoutRef.current && clearTimeout(timeoutRef.current), []);
  return { toast, showToast };
}
function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 60,
      background: toast.tone === "error" ? "#B6473F" : INK, color: "#fff", padding: "12px 20px",
      borderRadius: 8, fontSize: 14, fontWeight: 500, boxShadow: "0 6px 20px rgba(0,0,0,0.22)",
      display: "flex", alignItems: "center", gap: 10, maxWidth: "min(90vw, 420px)",
    }}>
      {toast.tone === "error" ? <X size={16} /> : <Check size={16} />}
      {toast.message}
    </div>
  );
}

// Tracks the current Supabase Auth session. Staff accounts are created by the property owner
// directly in Supabase (Authentication -> Users -> Add user) — there's no public sign-up screen
// here, since this is an internal team tool, not a consumer product.
function useAuth() {
  const [session, setSession] = useState(undefined); // undefined = still checking, null = signed out
  useEffect(() => {
    if (!supabaseConfigured) return; // App() shows a setup-error screen in this case instead
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);
  const signOut = () => supabase && supabase.auth.signOut();
  return { session, loading: supabaseConfigured && session === undefined, signOut };
}

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) return setError("Enter your email and password.");
    setError("");
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setSubmitting(false);
    if (signInError) setError(signInError.message || "Could not sign in — check your email and password.");
  };

  return (
    <div style={{
      fontFamily: "'IBM Plex Sans', sans-serif", minHeight: "100vh", background: PAPER,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <style>{FONT_IMPORT}</style>
      <div style={{ maxWidth: 380, width: "100%", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 28 }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, color: INK, marginBottom: 4 }}>Spare Key</div>
        <div style={{ fontSize: 13.5, color: TEXT_MUTED, marginBottom: 22 }}>Sign in with your staff account to continue.</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Email">
            <input type="email" style={inputStyle} value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} autoFocus />
          </Field>
          <Field label="Password">
            <input type="password" style={inputStyle} value={password} onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />
          </Field>
        </div>
        {error && (
          <div style={{ color: "#B6473F", fontSize: 13, marginTop: 12, background: "#F6DEDE", padding: "8px 12px", borderRadius: 6 }}>
            {error}
          </div>
        )}
        <button type="button" onClick={submit} disabled={submitting} style={{
          marginTop: 16, width: "100%", background: MUSTARD, color: INK, border: "none", padding: "11px 18px",
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: submitting ? "default" : "pointer", opacity: submitting ? 0.7 : 1,
        }}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
        <div style={{ fontSize: 12, color: TEXT_MUTED, marginTop: 16 }}>
          Don't have an account? Ask the property owner to add you in Supabase.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { session, loading: authLoading, signOut } = useAuth();

  if (!supabaseConfigured) {
    return (
      <div style={{
        fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#FAF6EE",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
      }}>
        <div style={{ maxWidth: 480, background: "#fff", border: "1px solid #E4DAC4", borderRadius: 10, padding: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10, color: "#1E2A44" }}>Database not connected</div>
          <div style={{ fontSize: 14, color: "#333", lineHeight: 1.6 }}>
            Spare Key can't reach Supabase — <code>VITE_SUPABASE_URL</code> or <code>VITE_SUPABASE_ANON_KEY</code> is
            missing or invalid in this build.
            <br /><br />
            If you deployed by dragging the <code>dist</code> folder onto Netlify (Netlify Drop): environment
            variables added in Netlify's dashboard only apply to builds Netlify itself runs — they don't reach a
            folder you built locally and dropped in. Create a <code>.env</code> file with real values
            (see <code>.env.example</code>), run <code>npm run build</code> again, and drag the new{" "}
            <code>dist</code> folder onto Netlify to replace this deploy.
          </div>
        </div>
      </div>
    );
  }
  if (authLoading) return null; // avoids a login-screen flash while the session check resolves
  if (!session) return <LoginScreen />;
  return <AppShell userEmail={session.user.email} onSignOut={signOut} />;
}

function AppShell({ userEmail, onSignOut }) {
  const {
    bookings, properties, expenses, startingBankBalance, loading, error,
    persistBookings, persistProperties, persistExpenses, persistStartingBankBalance,
  } = useStorage();
  const [tab, setTab] = useState("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  // One-shot signal so the Dashboard's "Add a new property" button can jump to the Bookings tab
  // with that form already open — BookingsTab consumes it once on mount and clears it, so a later
  // ordinary visit to the tab (via the sidebar) doesn't auto-open it again.
  const [bookingsIntent, setBookingsIntent] = useState(null);
  const openAddProperty = () => { setBookingsIntent({ type: "addProperty" }); setTab("bookings"); };
  const openNewBookingFor = (checkIn) => { setBookingsIntent({ type: "newBooking", checkIn }); setTab("bookings"); };
  const { toast, showToast } = useToast();

  const NAV = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "bookings", label: "Bookings", icon: NotebookPen },
    { id: "calendar", label: "Calendar", icon: CalendarDays },
    { id: "revenue", label: "Revenue", icon: IndianRupee },
    { id: "expenses", label: "Expenses", icon: Wallet },
  ];

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", background: PAPER, minHeight: "100vh", color: INK }}>
      <style>{FONT_IMPORT}{`
        * { box-sizing: border-box; }
        input, select, textarea, button { font-family: 'IBM Plex Sans', sans-serif; }
        input:focus, select:focus, textarea:focus { outline: 2px solid ${MUSTARD}; outline-offset: 1px; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-thumb { background: ${LINE}; border-radius: 4px; }
      `}</style>

      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Sidebar */}
        {navOpen && (
          <div onClick={() => setNavOpen(false)} className="topbar-mobile" style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 35,
          }} />
        )}
        <div style={{
          width: 220, background: INK, color: PAPER, flexShrink: 0,
          display: navOpen ? "flex" : "none", flexDirection: "column",
          position: "fixed", top: 0, bottom: 0, left: 0, zIndex: 40,
        }} className="sidebar-desktop">
          <SidebarContent tab={tab} setTab={(t) => { setTab(t); setNavOpen(false); }} nav={NAV} userEmail={userEmail} onSignOut={onSignOut} />
        </div>

        <style>{`
          @media (min-width: 860px) {
            .sidebar-desktop { display: flex !important; }
            .topbar-mobile { display: none !important; }
            .main-content { margin-left: 220px; }
          }
        `}</style>

        {/* Mobile topbar */}
        <div className="topbar-mobile" style={{
          position: "fixed", top: 0, left: 0, right: 0, height: 56, background: INK, color: PAPER,
          display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", zIndex: 30,
        }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600 }}>Spare Key</span>
          <button onClick={() => setNavOpen(!navOpen)} style={{
            background: "none", border: "none", color: PAPER, fontSize: 14, cursor: "pointer",
          }}>{navOpen ? "Close" : "Menu"}</button>
        </div>

        <div className="main-content" style={{ flex: 1, padding: "24px 24px 64px", marginTop: 56 }}>
          <div style={{ maxWidth: 1100, margin: "0 auto" }}>
            {error && (
              <div style={{ background: "#F6DEDE", color: "#8A2E2E", padding: "10px 14px", borderRadius: 6, marginBottom: 16, fontSize: 14 }}>
                {error}
              </div>
            )}
            {loading ? (
              <div style={{ color: TEXT_MUTED, padding: 40, textAlign: "center" }}>Loading your bookings…</div>
            ) : (
              <>
                {tab === "dashboard" && (
                  <Dashboard
                    bookings={bookings} properties={properties} expenses={expenses}
                    startingBankBalance={startingBankBalance} persistStartingBankBalance={persistStartingBankBalance}
                    setTab={setTab} onAddProperty={openAddProperty}
                  />
                )}
                {tab === "bookings" && (
                  <BookingsTab
                    bookings={bookings} properties={properties}
                    persistBookings={persistBookings} persistProperties={persistProperties}
                    userEmail={userEmail}
                    intent={bookingsIntent}
                    onIntentConsumed={() => setBookingsIntent(null)}
                    showToast={showToast}
                  />
                )}
                {tab === "calendar" && <CalendarTab bookings={bookings} properties={properties} onAddBooking={openNewBookingFor} />}
                {tab === "revenue" && <RevenueTab bookings={bookings} properties={properties} expenses={expenses} />}
                {tab === "expenses" && (
                  <ExpensesTab expenses={expenses} properties={properties} persistExpenses={persistExpenses} userEmail={userEmail} showToast={showToast} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <Toast toast={toast} />
    </div>
  );
}
function SidebarContent({ tab, setTab, nav, userEmail, onSignOut }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "28px 0" }}>
      <div style={{ padding: "0 24px 28px", borderBottom: `1px solid ${INK_SOFT}` }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, lineHeight: 1.1 }}>Spare Key</div>
        <div style={{ fontSize: 12.5, color: "#AEB8CC", marginTop: 4 }}>Whimsy Suite, Jaipur</div>
      </div>
      <div style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {nav.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 8,
            background: tab === id ? MUSTARD : "transparent", color: tab === id ? INK : PAPER,
            border: "none", cursor: "pointer", fontSize: 14.5, fontWeight: tab === id ? 600 : 500,
            textAlign: "left", width: "100%", transition: "background 0.15s",
          }}>
            <Icon size={17} /> {label}
          </button>
        ))}
      </div>
      <div style={{ padding: "14px 24px 0", borderTop: `1px solid ${INK_SOFT}` }}>
        <div style={{ fontSize: 12, color: "#AEB8CC", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Signed in as {userEmail}
        </div>
        <button onClick={onSignOut} style={{
          background: "none", border: `1px solid ${INK_SOFT}`, color: PAPER, padding: "7px 12px",
          borderRadius: 6, fontSize: 12.5, cursor: "pointer", width: "100%",
        }}>Sign out</button>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "18px 20px", flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 600, color: accent || INK }}>{value}</div>
      {sub && <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// Like StatCard, but with a pencil affordance to edit the starting balance folded into the
// figure — the one number on the Dashboard that's manually entered rather than derived from
// bookings and expenses (it exists to reconcile against whatever was in the account before this
// app started tracking anything).
function BankBalanceCard({ bankBalance, startingBankBalance, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(startingBankBalance);

  useEffect(() => { setDraft(startingBankBalance); }, [startingBankBalance]);

  const save = () => {
    onSave(Number(draft) || 0);
    setEditing(false);
  };

  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: "18px 20px", flex: 1, minWidth: 220 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginBottom: 6 }}>Bank balance</div>
        <button onClick={() => setEditing((e) => !e)} title="Set starting balance" style={{
          background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED, padding: 0, lineHeight: 0,
        }}>
          <Pencil size={13} />
        </button>
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 600, color: bankBalance >= 0 ? "#3F6B4E" : "#B6473F" }}>
        {inr(Math.round(bankBalance))}
      </div>
      <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 4 }}>
        revenue paid out − expenses{startingBankBalance ? ` + ${inr(startingBankBalance)} starting balance` : ""}
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <input
            type="number" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && save()}
            style={{ ...inputStyle, width: 110, padding: "6px 8px", fontSize: 13 }}
          />
          <button onClick={save} style={{
            background: MUSTARD, color: INK, border: "none", borderRadius: 6, padding: "0 12px",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>Save</button>
        </div>
      )}
    </div>
  );
}

function Dashboard({ bookings, properties, expenses = [], startingBankBalance = 0, persistStartingBankBalance, setTab, onAddProperty }) {
  const active = bookings.filter((b) => !b.cancelled);
  const today = todayStrIST();
  const totalRevenue = active.reduce((s, b) => s + collectedEarnings(b, today), 0);
  const pendingPayouts = active.reduce((s, b) => s + pendingAirbnbPayout(b, today), 0);
  const dueFromGuests = active.reduce((s, b) => s + (Number(b.dueAmount) || 0), 0);
  const totalOutstanding = dueFromGuests + pendingPayouts;
  const totalExpensesOverall = useMemo(() => totalExpensesAllTime(expenses), [expenses]);
  const bankBalance = startingBankBalance + totalRevenue - totalExpensesOverall;
  // Once past noon/1 PM IST, today's checkout/check-in is treated as already done, so "next"
  // skips ahead to whatever's actually still upcoming instead of pointing at a guest who's
  // already left or already arrived.
  const checkoutFloor = isPastCheckoutTimeIST() ? addDays(today, 1) : today;
  const checkinFloor = isPastCheckinTimeIST() ? addDays(today, 1) : today;

  const nextCheckout = active
    .filter((b) => b.checkOut >= checkoutFloor)
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut))[0] || null;
  const nextCheckin = active
    .filter((b) => b.checkIn >= checkinFloor)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0] || null;

  const byProperty = properties.map((p) => ({
    property: p,
    revenue: active.filter((b) => b.property === p).reduce((s, b) => s + collectedEarnings(b, today), 0),
  }));
  const maxRev = Math.max(1, ...byProperty.map((p) => p.revenue));

  // Only counts fees on bookings that have actually been paid out — the fee hasn't really been
  // deducted from anything yet for a stay that hasn't checked in.
  const airbnbFeesLost = active.reduce((s, b) => {
    if (b.checkIn > today) return s;
    const { guestPaidAirbnb, airbnbPayout } = paymentBreakdown(b);
    return s + Math.max(0, guestPaidAirbnb - airbnbPayout);
  }, 0);

  return (
    <div>
      <SectionHeader title="Dashboard" subtitle="Revenue and stays across every property, in one place." />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 24 }}>
        <StatCard label="Total revenue collected" value={inr(totalRevenue)} accent={MUSTARD_DEEP} sub="direct payments + Airbnb payouts already released" />
        <BankBalanceCard bankBalance={bankBalance} startingBankBalance={startingBankBalance} onSave={persistStartingBankBalance} />
        <StatCard label="Airbnb fees & taxes" value={inr(airbnbFeesLost)} sub="difference between guest paid and your payout" />
        <StatCard
          label="Outstanding balance"
          value={inr(totalOutstanding)}
          sub={totalOutstanding > 0 ? `${inr(pendingPayouts)} pending Airbnb payout · ${inr(dueFromGuests)} due from guests` : "all settled"}
        />
        <StatCard label="Bookings on record" value={active.length} />
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <PanelHeader>Next checkout</PanelHeader>
          {nextCheckout ? (
            <GuestRow b={nextCheckout} dateField="checkOut" properties={properties} />
          ) : (
            <EmptyNote text="No upcoming checkouts on record." />
          )}
        </div>
        <div style={{ flex: "1 1 320px" }}>
          <PanelHeader>Next check-in</PanelHeader>
          {nextCheckin ? (
            <GuestRow b={nextCheckin} dateField="checkIn" properties={properties} />
          ) : (
            <EmptyNote text="No upcoming check-ins on record." />
          )}
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <PanelHeader>Revenue by property</PanelHeader>
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20 }}>
          {byProperty.map((p) => (
            <div key={p.property} style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 130, fontSize: 13.5, flexShrink: 0 }}>{p.property}</div>
              <div style={{ flex: 1, background: PAPER_DIM, borderRadius: 4, height: 14, position: "relative" }}>
                <div style={{
                  width: `${Math.max(0, (p.revenue / maxRev) * 100)}%`, background: propertyColor(properties, p.property),
                  height: "100%", borderRadius: 4, minWidth: p.revenue > 0 ? 4 : 0,
                }} />
              </div>
              <div style={{ width: 100, fontSize: 13.5, textAlign: "right", fontWeight: 500 }}>{inr(p.revenue)}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button onClick={onAddProperty} style={{
          background: MUSTARD, color: INK, border: "none", padding: "11px 20px",
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex",
          alignItems: "center", gap: 8,
        }}>
          <Plus size={16} /> Add a new property
        </button>
        <button onClick={() => setTab("bookings")} style={{
          background: "#fff", color: INK, border: `1px solid ${LINE}`, padding: "11px 20px",
          borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", display: "inline-flex",
          alignItems: "center", gap: 8,
        }}>
          <NotebookPen size={16} /> View all bookings
        </button>
      </div>
    </div>
  );
}

function GuestRow({ b, dateField, properties }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: propertyColor(properties, b.property), flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.guest}</div>
        <div style={{ fontSize: 12, color: TEXT_MUTED }}>{b.property}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: INK_SOFT, flexShrink: 0 }}>
        {new Date(b[dateField] + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
      </div>
    </div>
  );
}

function SectionHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 30, fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 14, color: TEXT_MUTED, marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}
function PanelHeader({ children }) {
  return <div style={{ fontSize: 13.5, fontWeight: 600, color: INK_SOFT, marginBottom: 10, textTransform: "none" }}>{children}</div>;
}
function EmptyNote({ text }) {
  return (
    <div style={{ background: PAPER_DIM, border: `1px dashed ${LINE}`, borderRadius: 8, padding: "16px", color: TEXT_MUTED, fontSize: 13.5 }}>
      {text}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 12.5, color: TEXT_MUTED, fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}
const inputStyle = {
  border: `1px solid ${LINE}`, borderRadius: 7, padding: "9px 11px", fontSize: 14, background: "#fff", color: INK, width: "100%",
};

// Builds a Google-Sheets-importable CSV snapshot of every booking, and triggers a browser download.
// This is a manual backup step — Claude artifacts can't reach external services like Google Sheets
// directly, since the sandbox they run in blocks outbound network calls.
function downloadBackupCSV(bookings) {
  const cols = [
    "Guest Name", "Phone", "Property", "Check-in", "Check-out", "Guests", "Total Amount",
    "Guest Paid via Airbnb", "Your Airbnb Payout", "Paid Directly", "Direct Payment Mode",
    "Amount Due", "Source", "Created By", "Updated By", "Notes", "Cancelled",
  ];
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = bookings.map((b) => {
    const { guestPaidAirbnb, airbnbPayout, direct, directMode } = paymentBreakdown(b);
    return [
      b.guest, b.phone, b.property, b.checkIn, b.checkOut, b.guests, b.totalAmount,
      guestPaidAirbnb || "", airbnbPayout || "", direct || "", direct ? directMode : "",
      b.dueAmount || "", b.source, b.createdBy, b.updatedBy, b.notes, b.cancelled ? "Y" : "N",
    ].map(esc).join(",");
  });
  const csv = [cols.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `spare-key-backup-${todayStr()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function BookingsTab({ bookings, properties, persistBookings, persistProperties, userEmail, intent, onIntentConsumed, showToast }) {
  const [form, setForm] = useState(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [newProperty, setNewProperty] = useState("");
  const [filterProperty, setFilterProperty] = useState("All");
  const [query, setQuery] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreError, setRestoreError] = useState("");
  const [formError, setFormError] = useState("");
  const formRef = useRef(null);
  const addPropertyRef = useRef(null);

  useEffect(() => {
    if (!form.property && properties.length) setForm((f) => ({ ...f, property: properties[0] }));
  }, [properties]); // eslint-disable-line

  // Consumed exactly once on mount — arriving here via the Dashboard's "Add a new property"
  // button, or the Calendar's "Add a booking" on an empty day, sets things up immediately without
  // leaving a stale flag that would repeat the action on a later, unrelated visit to this tab.
  useEffect(() => {
    if (intent?.type === "addProperty") {
      setShowAddProperty(true);
    } else if (intent?.type === "newBooking") {
      setForm({ ...blankForm(), checkIn: intent.checkIn, checkOut: addDays(intent.checkIn, 1) });
      setShowForm(true);
    }
    if (intent) onIntentConsumed && onIntentConsumed();
  }, []); // eslint-disable-line

  // The form renders above the bookings list — on a long list, opening it (especially for Edit,
  // triggered from a card further down) can land off-screen and look like the button did nothing.
  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showForm]);

  useEffect(() => {
    if (showAddProperty && addPropertyRef.current) {
      addPropertyRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [showAddProperty]);

  // Seeds property from the current list rather than leaving it "" — the <select> falls back to
  // showing its first option whenever the controlled value doesn't match any option, so a blank
  // property here looked selected in the UI while actually failing the "Property is required" check.
  const blankForm = () => ({ ...emptyForm(), property: properties[0] || "" });
  const resetForm = () => { setForm(blankForm()); setShowForm(false); setFormError(""); };

  const submit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!form.guest.trim()) return setFormError("Guest name is required.");
    if (!form.property) return setFormError("Property is required.");
    if (!form.checkIn) return setFormError("Check-in date is required.");
    if (!form.checkOut) return setFormError("Check-out date is required.");
    setFormError("");
    const isNew = !form.id;
    const record = {
      ...form,
      id: form.id || (Date.now() + "-" + Math.random().toString(36).slice(2)),
      totalAmount: totalFromParts(form.guestPaidAirbnb, form.amountDirect),
      createdBy: isNew ? userEmail : form.createdBy || userEmail,
      updatedBy: userEmail,
    };
    let next;
    if (form.id) {
      next = bookings.map((b) => (b.id === form.id ? record : b));
    } else {
      next = [...bookings, record];
    }
    persistBookings(next);
    resetForm();
    showToast(isNew ? "Booking added successfully" : "Booking updated successfully");
  };

  const editBooking = (b) => { setForm(b); setShowForm(true); setFormError(""); };
  const deleteBooking = (id, guest) => {
    if (!window.confirm(`Delete the booking for ${guest || "this guest"}? This can't be undone.`)) return;
    persistBookings(bookings.filter((b) => b.id !== id));
    showToast("Booking deleted");
  };
  const addProperty = () => {
    const name = newProperty.trim();
    if (!name || properties.includes(name)) return;
    persistProperties([...properties, name]);
    setNewProperty("");
    setShowAddProperty(false);
    showToast(`"${name}" added as a new property`);
  };

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const runImportParse = () => {
    setImportError("");
    try {
      const { bookings: parsed, newProperties } = parseAirbnbCSV(importText, properties);
      if (parsed.length === 0) {
        setImportError("Couldn't find any reservation rows in that file — make sure it's the Airbnb transaction/earnings CSV export.");
        setImportPreview(null);
        return;
      }
      const existingRefs = new Set(bookings.map((b) => b.importRef).filter(Boolean));
      const fresh = parsed.filter((b) => !existingRefs.has(b.importRef));
      const dupes = parsed.length - fresh.length;
      setImportPreview({ fresh, dupes, newProperties });
    } catch (err) {
      setImportError("Couldn't read that file — check it's a CSV export from Airbnb.");
      setImportPreview(null);
    }
  };

  const confirmImport = () => {
    if (!importPreview) return;
    if (importPreview.newProperties.length) {
      persistProperties([...properties, ...importPreview.newProperties]);
    }
    const stamped = importPreview.fresh.map((b) => ({ ...b, createdBy: userEmail, updatedBy: userEmail }));
    persistBookings([...bookings, ...stamped]);
    setShowImport(false); setImportText(""); setImportPreview(null); setImportError("");
    showToast(`${stamped.length} booking${stamped.length === 1 ? "" : "s"} imported successfully`);
  };

  const handleRestoreFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setRestoreText(String(reader.result || ""));
    reader.readAsText(file);
  };

  const runRestoreParse = () => {
    setRestoreError("");
    try {
      const parsed = parseBackupCSV(restoreText);
      if (parsed.length === 0) {
        setRestoreError("Couldn't find any bookings in that file — make sure it's a Stay Ledger backup CSV (from \"Download backup CSV\").");
        setRestorePreview(null);
        return;
      }
      const existingByKey = {};
      bookings.forEach((b) => { existingByKey[bookingNaturalKey(b)] = b; });
      const toUpdate = [], toAdd = [];
      parsed.forEach((row) => {
        const key = bookingNaturalKey(row);
        const match = existingByKey[key];
        if (match) toUpdate.push({ ...row, id: match.id, importRef: match.importRef, createdBy: match.createdBy || row.createdBy || userEmail, updatedBy: userEmail });
        else toAdd.push({ ...row, id: Date.now() + "-" + Math.random().toString(36).slice(2), createdBy: row.createdBy || userEmail, updatedBy: userEmail });
      });
      setRestorePreview({ toUpdate, toAdd });
    } catch (err) {
      setRestoreError("Couldn't read that file — make sure it's a Stay Ledger backup CSV.");
      setRestorePreview(null);
    }
  };

  const confirmRestore = () => {
    if (!restorePreview) return;
    const updateIds = new Set(restorePreview.toUpdate.map((b) => b.id));
    const merged = bookings.map((b) => updateIds.has(b.id) ? restorePreview.toUpdate.find((u) => u.id === b.id) : b);
    persistBookings([...merged, ...restorePreview.toAdd]);
    setShowRestore(false); setRestoreText(""); setRestorePreview(null); setRestoreError("");
    showToast("Backup restored successfully");
  };

  const filtered = bookings
    .filter((b) => filterProperty === "All" || b.property === filterProperty)
    .filter((b) => !query.trim() || b.guest.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.checkIn.localeCompare(a.checkIn));

  return (
    <div>
      <SectionHeader title="Bookings" subtitle="Add, edit, and review every stay." />

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18, alignItems: "center" }}>
        <button onClick={() => { setForm(blankForm()); setShowForm(true); setFormError(""); }} style={{
          background: MUSTARD, color: INK, border: "none", padding: "10px 18px", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Plus size={16} /> New booking
        </button>
        <button onClick={() => setShowImport(true)} style={{
          background: "#fff", color: INK, border: `1px solid ${LINE}`, padding: "10px 16px", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Upload size={16} /> Import from Airbnb CSV
        </button>
        <button onClick={() => setShowRestore(true)} style={{
          background: "#fff", color: INK, border: `1px solid ${LINE}`, padding: "10px 16px", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Upload size={16} /> Restore from backup
        </button>
        <button onClick={() => downloadBackupCSV(bookings)} disabled={bookings.length === 0} style={{
          background: "#fff", color: bookings.length ? INK : TEXT_MUTED, border: `1px solid ${LINE}`, padding: "10px 16px", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: bookings.length ? "pointer" : "default", display: "flex", alignItems: "center", gap: 8,
        }}>
          <Download size={16} /> Download backup CSV
        </button>
        <input placeholder="Search guest…" value={query} onChange={(e) => setQuery(e.target.value)}
          style={{ ...inputStyle, width: 180 }} />
        <select value={filterProperty} onChange={(e) => setFilterProperty(e.target.value)} style={{ ...inputStyle, width: 170 }}>
          <option>All</option>
          {properties.map((p) => <option key={p}>{p}</option>)}
        </select>
        <button onClick={() => setShowAddProperty(true)} style={{
          background: "#fff", color: INK, border: `1px solid ${LINE}`, padding: "10px 16px", borderRadius: 8,
          fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginLeft: "auto",
        }}>
          <Plus size={16} /> Add property
        </button>
      </div>

      {showAddProperty && (
        <div ref={addPropertyRef} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600 }}>Add a new property</div>
            <button type="button" onClick={() => { setShowAddProperty(false); setNewProperty(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED }}>
              <X size={18} />
            </button>
          </div>
          <Field label="Property name">
            <input style={inputStyle} value={newProperty} onChange={(e) => setNewProperty(e.target.value)}
              placeholder="e.g. Whimsy Suite" autoFocus onKeyDown={(e) => e.key === "Enter" && addProperty()} />
          </Field>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={addProperty} disabled={!newProperty.trim()} style={{
              background: newProperty.trim() ? MUSTARD : PAPER_DIM, color: INK, border: "none", padding: "10px 20px",
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: newProperty.trim() ? "pointer" : "default",
            }}>Add property</button>
            <button type="button" onClick={() => { setShowAddProperty(false); setNewProperty(""); }} style={{
              background: "#fff", color: INK, border: `1px solid ${LINE}`, padding: "10px 20px", borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}

      {showImport && (
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600 }}>Import from Airbnb CSV</div>
            <button type="button" onClick={() => { setShowImport(false); setImportPreview(null); setImportText(""); setImportError(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 12 }}>
            Upload the CSV you export from your Airbnb transaction history (Insights → Earnings → Export). It's read in your browser and never leaves this device except into your shared booking data.
          </div>
          <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ marginBottom: 10, fontSize: 13 }} />
          <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 6 }}>or paste the CSV contents:</div>
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Date,Arriving by date,Type,Confirmation Code,..."
            style={{ ...inputStyle, minHeight: 90, fontFamily: "monospace", fontSize: 11.5, resize: "vertical" }} />
          {importError && <div style={{ color: "#B6473F", fontSize: 13, marginTop: 8 }}>{importError}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={runImportParse} disabled={!importText.trim()} style={{
              background: importText.trim() ? MUSTARD : PAPER_DIM, color: INK, border: "none", padding: "9px 18px",
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: importText.trim() ? "pointer" : "default",
            }}>Parse file</button>
          </div>

          {importPreview && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
              <div style={{ fontSize: 13.5, marginBottom: 8 }}>
                Found <strong>{importPreview.fresh.length}</strong> new booking{importPreview.fresh.length === 1 ? "" : "s"} to add
                {importPreview.dupes > 0 && <> ({importPreview.dupes} already in your data, skipped)</>}.
                {importPreview.newProperties.length > 0 && <> Will add new propert{importPreview.newProperties.length === 1 ? "y" : "ies"}: {importPreview.newProperties.join(", ")}.</>}
              </div>
              {importPreview.fresh.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
                  {importPreview.fresh.map((b) => (
                    <div key={b.id} style={{ fontSize: 12.5, display: "flex", gap: 10, padding: "6px 10px", background: PAPER_DIM, borderRadius: 6 }}>
                      <span style={{ fontWeight: 600, flex: "0 0 120px" }}>{b.guest}</span>
                      <span style={{ color: TEXT_MUTED }}>{b.checkIn} → {b.checkOut}</span>
                      <span style={{ marginLeft: "auto" }}>{inr(b.guestPaidAirbnb)} paid · {inr(b.airbnbPayout)} to you</span>
                    </div>
                  ))}
                </div>
              )}
              {importPreview.fresh.length > 0 ? (
                <button onClick={confirmImport} style={{
                  background: MUSTARD, color: INK, border: "none", padding: "9px 18px", borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Check size={16} /> Add {importPreview.fresh.length} booking{importPreview.fresh.length === 1 ? "" : "s"}
                </button>
              ) : (
                <div style={{ fontSize: 13, color: TEXT_MUTED }}>Nothing new to add — these bookings are already in your data.</div>
              )}
            </div>
          )}
        </div>
      )}

      {showRestore && (
        <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600 }}>Restore from backup</div>
            <button type="button" onClick={() => { setShowRestore(false); setRestorePreview(null); setRestoreText(""); setRestoreError(""); }}
              style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize: 13, color: TEXT_MUTED, marginBottom: 12 }}>
            Use this to bring data made on another device or an older version in sync with what you're looking at now.
            Upload a CSV from "Download backup CSV" (not an Airbnb export). Matching bookings are updated in place by
            guest + property + dates; anything new is added. Nothing already here is ever deleted.
          </div>
          <input type="file" accept=".csv,text/csv" onChange={handleRestoreFile} style={{ marginBottom: 10, fontSize: 13 }} />
          <div style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 6 }}>or paste the CSV contents:</div>
          <textarea value={restoreText} onChange={(e) => setRestoreText(e.target.value)} placeholder="Guest Name,Phone,Property,Check-in,Check-out,..."
            style={{ ...inputStyle, minHeight: 90, fontFamily: "monospace", fontSize: 11.5, resize: "vertical" }} />
          {restoreError && <div style={{ color: "#B6473F", fontSize: 13, marginTop: 8 }}>{restoreError}</div>}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button onClick={runRestoreParse} disabled={!restoreText.trim()} style={{
              background: restoreText.trim() ? MUSTARD : PAPER_DIM, color: INK, border: "none", padding: "9px 18px",
              borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: restoreText.trim() ? "pointer" : "default",
            }}>Compare</button>
          </div>

          {restorePreview && (
            <div style={{ marginTop: 16, borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
              <div style={{ fontSize: 13.5, marginBottom: 8 }}>
                <strong>{restorePreview.toUpdate.length}</strong> existing booking{restorePreview.toUpdate.length === 1 ? "" : "s"} will be updated,
                {" "}<strong>{restorePreview.toAdd.length}</strong> new booking{restorePreview.toAdd.length === 1 ? "" : "s"} will be added.
              </div>
              {restorePreview.toUpdate.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
                  {restorePreview.toUpdate.map((b) => (
                    <div key={b.id} style={{ fontSize: 12.5, padding: "6px 10px", background: PAPER_DIM, borderRadius: 6 }}>
                      <strong>{b.guest}</strong> <span style={{ color: TEXT_MUTED }}>· {b.property} · {b.checkIn} → {b.checkOut} · updating to {inr(b.totalAmount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {(restorePreview.toUpdate.length > 0 || restorePreview.toAdd.length > 0) ? (
                <button onClick={confirmRestore} style={{
                  background: MUSTARD, color: INK, border: "none", padding: "9px 18px", borderRadius: 8,
                  fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
                }}>
                  <Check size={16} /> Apply restore
                </button>
              ) : (
                <div style={{ fontSize: 13, color: TEXT_MUTED }}>Everything in this backup already matches what's here.</div>
              )}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div ref={formRef} style={{
          background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 22,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600 }}>
              {form.id ? "Edit booking" : "New booking"}
            </div>
            <button type="button" onClick={resetForm} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED }}>
              <X size={18} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            <Field label="Guest name *">
              <input style={inputStyle} value={form.guest} onChange={(e) => setForm({ ...form, guest: e.target.value })} />
            </Field>
            <Field label="Phone">
              <input style={inputStyle} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Property *">
              <select style={inputStyle} value={form.property} onChange={(e) => setForm({ ...form, property: e.target.value })}>
                {properties.map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Guests">
              <input type="number" min="1" style={inputStyle} value={form.guests} onChange={(e) => setForm({ ...form, guests: e.target.value })} />
            </Field>
            <Field label="Check-in *">
              <input type="date" style={inputStyle} value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} />
            </Field>
            <Field label="Check-out *">
              <input type="date" style={inputStyle} value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} />
            </Field>
            <Field label="Total amount (₹)">
              <div style={{ ...inputStyle, background: PAPER_DIM, color: INK, cursor: "default" }}>
                {inr(totalFromParts(form.guestPaidAirbnb, form.amountDirect))}
              </div>
              <div style={{ fontSize: 11, color: TEXT_MUTED }}>Auto-calculated: guest paid via Airbnb + paid directly.</div>
            </Field>
            <Field label="Guest paid via Airbnb (₹)">
              <input type="number" min="0" style={inputStyle} value={form.guestPaidAirbnb}
                onChange={(e) => {
                  const guestPaidAirbnb = e.target.value;
                  const autoFill = form.airbnbPayout === "" || form.airbnbPayout === emptyForm().airbnbPayout;
                  setForm((f) => ({
                    ...f, guestPaidAirbnb,
                    airbnbPayout: autoFill && guestPaidAirbnb !== "" ? Math.round(Number(guestPaidAirbnb) * 0.97) : f.airbnbPayout,
                  }));
                }} />
            </Field>
            <Field label="Your Airbnb payout (₹)">
              <div style={{ display: "flex", gap: 6 }}>
                <input type="number" min="0" style={inputStyle} value={form.airbnbPayout} onChange={(e) => setForm({ ...form, airbnbPayout: e.target.value })} />
              </div>
              <div style={{ fontSize: 11, color: TEXT_MUTED }}>Auto-estimated at 3% fee — overwrite with the real payout once Airbnb shows it.</div>
            </Field>
            <Field label="Paid directly (₹)">
              <input type="number" style={inputStyle} value={form.amountDirect} onChange={(e) => setForm({ ...form, amountDirect: e.target.value })} />
              <div style={{ fontSize: 11, color: TEXT_MUTED }}>Enter a negative amount for a promotional booking (a discount applied as credit).</div>
            </Field>
            <Field label="Amount due from guest (₹)">
              <input type="number" min="0" style={inputStyle} value={form.dueAmount} onChange={(e) => setForm({ ...form, dueAmount: e.target.value })} placeholder="0" />
              <div style={{ fontSize: 11, color: TEXT_MUTED }}>Set this manually if the guest still owes a balance.</div>
            </Field>
            <Field label="Direct payment mode">
              <select style={inputStyle} value={form.directMode} onChange={(e) => setForm({ ...form, directMode: e.target.value })}>
                {DIRECT_PAYMENT_MODES.map((m) => <option key={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="Source">
              <select style={inputStyle} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Logged by">
              <div style={{ ...inputStyle, background: PAPER_DIM, color: TEXT_MUTED, cursor: "default" }}>
                {form.id ? (form.createdBy || "—") : "You, on save"}
              </div>
            </Field>
            <Field label="Cancelled?">
              <select style={inputStyle} value={form.cancelled ? "yes" : "no"} onChange={(e) => setForm({ ...form, cancelled: e.target.value === "yes" })}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </Field>
          </div>
          <div style={{ marginTop: 14 }}>
            <Field label="Notes">
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          {formError && (
            <div style={{ color: "#B6473F", fontSize: 13, marginTop: 14, background: "#F6DEDE", padding: "8px 12px", borderRadius: 6 }}>
              {formError}
            </div>
          )}
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button type="button" onClick={submit} style={{
              background: MUSTARD, color: INK, border: "none", padding: "10px 20px", borderRadius: 8,
              fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
            }}>
              <Check size={16} /> {form.id ? "Save changes" : "Save booking"}
            </button>
            <button type="button" onClick={resetForm} style={{
              background: "#fff", border: `1px solid ${LINE}`, padding: "10px 20px", borderRadius: 8, fontSize: 14, cursor: "pointer",
            }}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.length === 0 && <EmptyNote text="No bookings match yet. Add one above to get started." />}
        {filtered.map((b) => {
          const { guestPaidAirbnb, airbnbPayout, direct, directMode } = paymentBreakdown(b);
          const earned = airbnbPayout + direct;
          const balance = Number(b.dueAmount) || 0;
          const parts = [];
          if (guestPaidAirbnb > 0) parts.push(`${inr(guestPaidAirbnb)} via Airbnb (you got ${inr(airbnbPayout)})`);
          // !== 0, not > 0 — a promotional booking's direct amount can be negative (a discount
          // applied as credit), and that should still show up rather than being silently dropped.
          if (direct !== 0) parts.push(`${inr(direct)} via ${directMode}`);
          const paidLabel = parts.length ? parts.join(" + ") : "not yet paid";
          return (
            <div key={b.id} style={{
              background: "#fff", border: `1px solid ${LINE}`, borderLeft: `4px solid ${propertyColor(properties, b.property)}`,
              borderRadius: 8, padding: "14px 16px", opacity: b.cancelled ? 0.55 : 1,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {b.guest} {b.cancelled && <span style={{ fontSize: 11.5, color: "#B6473F", fontWeight: 500 }}>· cancelled</span>}
                  </div>
                  <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <span><Home size={11} style={{ verticalAlign: -1 }} /> {b.property}</span>
                    <span>{b.checkIn} → {b.checkOut} ({daysBetween(b.checkIn, b.checkOut)}n)</span>
                    {b.phone && <span><Phone size={11} style={{ verticalAlign: -1 }} /> {b.phone}</span>}
                    {b.guests && <span><Users size={11} style={{ verticalAlign: -1 }} /> {b.guests}</span>}
                    <span><Tag size={11} style={{ verticalAlign: -1 }} /> {b.source}</span>
                  </div>
                  {b.notes && <div style={{ fontSize: 12.5, color: TEXT_MUTED, marginTop: 4, fontStyle: "italic" }}>{b.notes}</div>}
                  {b.createdBy && (
                    <div style={{ fontSize: 11, color: "#9AA3B0", marginTop: 4 }}>
                      Logged by {b.createdBy}{b.updatedBy && b.updatedBy !== b.createdBy && <> · edited by {b.updatedBy}</>}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: MUSTARD_DEEP }}>{inr(earned)} <span style={{ fontSize: 11.5, color: TEXT_MUTED, fontWeight: 400 }}>earned</span></div>
                  <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 1, maxWidth: 220 }}>{paidLabel}</div>
                  {balance > 0 && !b.cancelled && <div style={{ fontSize: 12.5, color: "#B6473F", marginTop: 2 }}>{inr(balance)} due from guest</div>}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                    <button onClick={() => editBooking(b)} style={{ background: "none", border: "none", cursor: "pointer", color: INK_SOFT }}><Pencil size={15} /></button>
                    <button onClick={() => deleteBooking(b.id, b.guest)} style={{ background: "none", border: "none", cursor: "pointer", color: "#B6473F" }}><Trash2 size={15} /></button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CAL_VISIBLE_LANES = 3;
const CAL_LANE_HEIGHT = 16;
const CAL_DAY_HEADER_HEIGHT = 22;

function occupiesDay(b, ds) {
  return b.checkIn <= ds && ds < b.checkOut;
}

function CalendarTab({ bookings, properties, onAddBooking }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState(null);
  const active = bookings.filter((b) => !b.cancelled);

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Grouped into 7-day rows so a multi-night stay can be drawn as one continuous bar spanning
  // its check-in through check-out-minus-one-night columns, instead of a separate chip repeated
  // in every day cell it touches. A stay that crosses a week boundary simply becomes two bars —
  // one per row — clipped to that row's dates.
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div>
      <SectionHeader title="Calendar" subtitle="Occupancy across every property, color-coded." />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} style={navBtnStyle}><ChevronLeft size={18} /></button>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600 }}>{monthLabel(cursor)}</div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} style={navBtnStyle}><ChevronRight size={18} /></button>
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        {properties.map((p) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: TEXT_MUTED }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: propertyColor(properties, p) }} />{p}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: TEXT_MUTED, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, paddingBottom: 4 }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} style={{ textAlign: "center" }}>{d}</div>
        ))}
      </div>

      {weeks.map((week, wi) => {
        const colDates = week.map((d) => (d ? ymdToISO(year, month, d) : null));

        // One bar per booking that touches this row, spanning every column it occupies here.
        const bars = [];
        active.forEach((b) => {
          let startCol = -1, endCol = -1;
          colDates.forEach((ds, c) => {
            if (ds && occupiesDay(b, ds)) {
              if (startCol === -1) startCol = c;
              endCol = c;
            }
          });
          if (startCol !== -1) bars.push({ booking: b, startCol, endCol });
        });
        bars.sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);

        // Greedy lane assignment (interval scheduling) so overlapping stays stack into separate
        // rows within the week instead of colliding — the same idea as a Gantt/booking calendar.
        const laneEnds = [];
        bars.forEach((bar) => {
          let lane = laneEnds.findIndex((endCol) => endCol < bar.startCol);
          if (lane === -1) { lane = laneEnds.length; laneEnds.push(bar.endCol); }
          else laneEnds[lane] = bar.endCol;
          bar.lane = lane;
        });
        const occupantsInCol = (c) => bars.filter((bar) => bar.startCol <= c && c <= bar.endCol).length;
        const cellHeight = CAL_DAY_HEADER_HEIGHT + CAL_VISIBLE_LANES * CAL_LANE_HEIGHT + 16;

        return (
          <div key={wi} style={{ position: "relative", marginBottom: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {week.map((d, ci) => {
                const ds = colDates[ci];
                const isToday = ds === todayStr();
                const overflow = ds ? Math.max(0, occupantsInCol(ci) - CAL_VISIBLE_LANES) : 0;
                return (
                  <div key={ci} onClick={() => ds && setSelected(ds)} style={{
                    minHeight: cellHeight, background: d ? "#fff" : "transparent",
                    border: d ? `1px solid ${isToday ? MUSTARD : LINE}` : "none",
                    borderRadius: 7, padding: d ? 6 : 0, cursor: d ? "pointer" : "default", position: "relative",
                  }}>
                    {d && <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 500, color: isToday ? MUSTARD_DEEP : INK }}>{d}</div>}
                    {overflow > 0 && (
                      <div style={{ position: "absolute", bottom: 4, left: 6, fontSize: 9.5, color: TEXT_MUTED }}>+{overflow} more</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{
              position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6,
              paddingTop: CAL_DAY_HEADER_HEIGHT + 6, pointerEvents: "none",
            }}>
              {bars.filter((bar) => bar.lane < CAL_VISIBLE_LANES).map((bar) => (
                <div key={bar.booking.id} title={bar.booking.guest} style={{
                  gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`, gridRow: 1,
                  marginTop: bar.lane * CAL_LANE_HEIGHT, height: 14, alignSelf: "start",
                  background: propertyColor(properties, bar.booking.property), color: "#fff", fontSize: 9.5,
                  borderRadius: 3, padding: "1px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{bar.booking.guest}</div>
              ))}
            </div>
          </div>
        );
      })}

      {selected && (
        <div style={{ marginTop: 20, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>
              {new Date(selected + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
            </div>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED }}><X size={16} /></button>
          </div>
          {active.filter((b) => b.checkIn <= selected && selected < b.checkOut).length === 0 ? (
            <div>
              <EmptyNote text="No stays on this date." />
              <button onClick={() => onAddBooking(selected)} style={{
                marginTop: 10, background: MUSTARD, color: INK, border: "none", padding: "9px 16px",
                borderRadius: 8, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex",
                alignItems: "center", gap: 7,
              }}>
                <Plus size={15} /> Add a booking for this date
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {active.filter((b) => b.checkIn <= selected && selected < b.checkOut).map((b) => (
                <div key={b.id} style={{ fontSize: 13.5, display: "flex", gap: 10, alignItems: "center" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: propertyColor(properties, b.property) }} />
                  <span style={{ fontWeight: 500 }}>{b.guest}</span>
                  <span style={{ color: TEXT_MUTED }}>· {b.property} · {b.checkIn === selected ? "checking in" : b.checkOut === addDays(selected, 1) ? "checking out tomorrow" : "staying"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
const navBtnStyle = { background: "#fff", border: `1px solid ${LINE}`, borderRadius: 7, padding: 8, cursor: "pointer", display: "flex" };

const DIRECT_COLOR = "#3B7A9E";

// Payment-mode and property splits scoped to a single month's allocated items, mirroring the
// all-time versions below but computed from just that month's slice of each booking.
function monthBreakdowns(items) {
  const byMode = {};
  const byProperty = {};
  items.forEach((it) => {
    const { allocAirbnb, allocDirect, booking } = it;
    if (allocAirbnb !== 0) byMode["Airbnb Payout"] = (byMode["Airbnb Payout"] || 0) + allocAirbnb;
    // A promotional booking's direct amount can be negative (a discount applied as credit), so
    // this counts it in too rather than silently dropping it from the breakdown.
    if (allocDirect !== 0) {
      const mode = booking.directMode || "UPI";
      byMode[mode] = (byMode[mode] || 0) + allocDirect;
    }
    if (!byProperty[booking.property]) byProperty[booking.property] = { airbnb: 0, direct: 0 };
    byProperty[booking.property].airbnb += allocAirbnb;
    byProperty[booking.property].direct += allocDirect;
  });
  return { byMode: Object.entries(byMode).filter(([, v]) => v !== 0), byProperty };
}

function RevenueTab({ bookings, properties, expenses = [] }) {
  const active = bookings.filter((b) => !b.cancelled);
  const [view, setView] = useState("overall");
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  const drillInto = (key) => { setSelectedMonthKey(key); setView("monthly"); };

  // Splits every booking's earnings across the calendar months it actually spans, proportional
  // to nights in each month — a booking running Aug 30 → Sep 3 contributes to both August and
  // September instead of being dumped entirely into its check-in month. Nights are tracked the
  // same way, so avg price/night = a month's earned revenue ÷ its actual booked nights.
  const monthly = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        airbnb: 0, direct: 0, revenue: 0, nights: 0, items: [],
      });
    }
    const byKey = Object.fromEntries(months.map((m) => [m.key, m]));

    active.forEach((b) => {
      const split = nightsByMonth(b.checkIn, b.checkOut);
      const totalNights = Object.values(split).reduce((s, n) => s + n, 0) || 1;
      const spansMultiple = Object.keys(split).length > 1;
      const { airbnbPayout, direct } = paymentBreakdown(b);
      Object.entries(split).forEach(([key, nights]) => {
        const m = byKey[key];
        if (!m) return;
        const frac = nights / totalNights;
        const allocAirbnb = airbnbPayout * frac, allocDirect = direct * frac;
        m.airbnb += allocAirbnb;
        m.direct += allocDirect;
        m.revenue += allocAirbnb + allocDirect;
        m.nights += nights;
        m.items.push({ booking: b, nights, totalNights, spansMultiple, allocated: allocAirbnb + allocDirect, allocAirbnb, allocDirect });
      });
    });
    months.forEach((m) => {
      m.expenses = expensesForMonthKey(expenses, m.key);
      m.profit = m.revenue - m.expenses;
      m.avgPerNight = m.nights > 0 ? m.revenue / m.nights : 0;
    });
    return months;
  }, [active, expenses]);

  const currentMonth = monthly[monthly.length - 1];

  const byMode = useMemo(() => {
    const map = {};
    active.forEach((b) => {
      const { airbnbPayout, direct, directMode } = paymentBreakdown(b);
      if (airbnbPayout !== 0) map["Airbnb Payout"] = (map["Airbnb Payout"] || 0) + airbnbPayout;
      // !== 0, not > 0 — a promotional booking's direct amount can be negative (a discount
      // applied as credit), and that should still count instead of being silently dropped.
      if (direct !== 0) map[directMode] = (map[directMode] || 0) + direct;
    });
    return Object.entries(map).filter(([, v]) => v !== 0);
  }, [active]);

  const byPropertyMode = useMemo(() => {
    // Property x payment-source drill-down: for each property, how much came via Airbnb vs direct.
    const map = {};
    properties.forEach((p) => (map[p] = { airbnb: 0, direct: 0 }));
    active.forEach((b) => {
      const { airbnbPayout, direct } = paymentBreakdown(b);
      if (!map[b.property]) map[b.property] = { airbnb: 0, direct: 0 };
      map[b.property].airbnb += airbnbPayout;
      map[b.property].direct += direct;
    });
    return map;
  }, [active, properties]);

  const totalRevenue = active.reduce((s, b) => s + hostEarnings(b), 0);
  const totalFees = active.reduce((s, b) => {
    const { guestPaidAirbnb, airbnbPayout } = paymentBreakdown(b);
    return s + Math.max(0, guestPaidAirbnb - airbnbPayout);
  }, 0);
  const totalExpensesOverall = useMemo(() => totalExpensesAllTime(expenses), [expenses]);
  const overallProfit = totalRevenue - totalExpensesOverall;
  const totalNightsOverall = active.reduce((s, b) => s + Math.max(0, daysBetween(b.checkIn, b.checkOut)), 0);
  const avgPricePerNightOverall = totalNightsOverall > 0 ? totalRevenue / totalNightsOverall : 0;

  const drillMonth = monthly.find((m) => m.key === selectedMonthKey) || currentMonth;
  const { byMode: monthByMode, byProperty: monthByPropertyMode } = monthBreakdowns(drillMonth.items);

  return (
    <div>
      <SectionHeader title="Revenue" subtitle="Overall performance, or drill into any month." />

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {[["overall", "Overall"], ["monthly", "By month"]].map(([val, label]) => (
          <button key={val} onClick={() => setView(val)} style={{
            padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
            border: `1px solid ${view === val ? MUSTARD : LINE}`,
            background: view === val ? "#FBF0DA" : "#fff", color: INK,
          }}>{label}</button>
        ))}
      </div>

      {view === "overall" ? (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <StatCard label="Total revenue" value={inr(totalRevenue)} accent={MUSTARD_DEEP} sub="all time" />
            <StatCard
              label="Avg price/night"
              value={totalNightsOverall > 0 ? inr(Math.round(avgPricePerNightOverall)) : "—"}
              sub={totalNightsOverall > 0 ? `across ${totalNightsOverall} booked nights` : "no booked nights yet"}
            />
            <StatCard label="Total expenses" value={inr(Math.round(totalExpensesOverall))} sub="all time" />
            <StatCard
              label="Overall profit"
              value={inr(Math.round(overallProfit))}
              accent={overallProfit >= 0 ? "#3F6B4E" : "#B6473F"}
              sub="revenue − expenses, all time"
            />
            <StatCard label="Airbnb fees & taxes absorbed" value={inr(totalFees)} />
          </div>

          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <PanelHeader>Last 12 months — revenue (mustard = Airbnb, blue = direct) — tap a bar to drill in</PanelHeader>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly} onClick={(e) => {
                if (e && typeof e.activeTooltipIndex === "number") drillInto(monthly[e.activeTooltipIndex].key);
              }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: TEXT_MUTED }} axisLine={{ stroke: LINE }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? (v / 1000) + "k" : v}`} />
                <Tooltip formatter={(v, name) => [inr(v), name === "airbnb" ? "Airbnb" : "Direct"]} contentStyle={{ fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}` }} />
                <Bar dataKey="airbnb" stackId="rev" fill={MUSTARD} radius={[0, 0, 0, 0]} cursor="pointer" />
                <Bar dataKey="direct" stackId="rev" fill={DIRECT_COLOR} radius={[4, 4, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <PanelHeader>Last 12 months — profit (green = profit, red = loss) — tap a bar to drill in</PanelHeader>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthly} onClick={(e) => {
                if (e && typeof e.activeTooltipIndex === "number") drillInto(monthly[e.activeTooltipIndex].key);
              }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: TEXT_MUTED }} axisLine={{ stroke: LINE }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 || v <= -1000 ? (v / 1000) + "k" : v}`} />
                <Tooltip formatter={(v) => [inr(v), "Profit"]} contentStyle={{ fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}` }} />
                <Bar dataKey="profit" radius={[4, 4, 4, 4]} cursor="pointer">
                  {monthly.map((m, i) => <Cell key={i} fill={m.profit >= 0 ? "#3F6B4E" : "#B6473F"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 280px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20 }}>
              <PanelHeader>By payment mode (all time)</PanelHeader>
              {byMode.length === 0 ? <EmptyNote text="No payments recorded yet." /> : byMode.map(([mode, val]) => (
                <div key={mode} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                  <span>{mode}</span>
                  <span style={{ fontWeight: 500 }}>{inr(val)} <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>({Math.round((val / totalRevenue) * 100) || 0}%)</span></span>
                </div>
              ))}
              {totalFees > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "9px 0 0", color: "#B6473F" }}>
                  <span>Airbnb fees & taxes absorbed</span>
                  <span style={{ fontWeight: 500 }}>−{inr(totalFees)}</span>
                </div>
              )}
            </div>
            <div style={{ flex: "1 1 280px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20 }}>
              <PanelHeader>By property (all time)</PanelHeader>
              {properties.map((p) => {
                const { airbnb, direct } = byPropertyMode[p] || { airbnb: 0, direct: 0 };
                const val = airbnb + direct;
                return (
                  <div key={p} style={{ padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: propertyColor(properties, p) }} />{p}
                      </span>
                      <span style={{ fontWeight: 500 }}>{inr(val)}</span>
                    </div>
                    {val !== 0 && (
                      <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 2, marginLeft: 16 }}>
                        {inr(airbnb)} Airbnb · {inr(direct)} direct
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <PanelHeader>Month</PanelHeader>
            <select value={drillMonth.key} onChange={(e) => setSelectedMonthKey(e.target.value)} style={{ ...inputStyle, width: 160 }}>
              {monthly.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <StatCard
              label="Revenue"
              value={inr(Math.round(drillMonth.revenue))}
              accent={MUSTARD_DEEP}
              sub={`${inr(Math.round(drillMonth.airbnb))} Airbnb · ${inr(Math.round(drillMonth.direct))} direct`}
            />
            <StatCard
              label="Avg price/night"
              value={drillMonth.nights > 0 ? inr(Math.round(drillMonth.avgPerNight)) : "—"}
              sub={drillMonth.nights > 0 ? `across ${drillMonth.nights} booked night${drillMonth.nights === 1 ? "" : "s"}` : "no booked nights"}
            />
            <StatCard label="Expenses" value={inr(Math.round(drillMonth.expenses))} />
            <StatCard
              label="Profit"
              value={inr(Math.round(drillMonth.profit))}
              accent={drillMonth.profit >= 0 ? "#3F6B4E" : "#B6473F"}
              sub={`${inr(Math.round(drillMonth.revenue))} revenue − ${inr(Math.round(drillMonth.expenses))} expenses`}
            />
          </div>

          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ flex: "1 1 280px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20 }}>
              <PanelHeader>By payment mode this month</PanelHeader>
              {monthByMode.length === 0 ? <EmptyNote text="No payments this month." /> : monthByMode.map(([mode, val]) => (
                <div key={mode} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                  <span>{mode}</span>
                  <span style={{ fontWeight: 500 }}>{inr(Math.round(val))}</span>
                </div>
              ))}
            </div>
            <div style={{ flex: "1 1 280px", background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20 }}>
              <PanelHeader>By property this month</PanelHeader>
              {properties.filter((p) => (monthByPropertyMode[p]?.airbnb || 0) + (monthByPropertyMode[p]?.direct || 0) !== 0).length === 0 ? (
                <EmptyNote text="No stays this month." />
              ) : properties.map((p) => {
                const { airbnb, direct } = monthByPropertyMode[p] || { airbnb: 0, direct: 0 };
                const val = airbnb + direct;
                if (val === 0) return null;
                return (
                  <div key={p} style={{ padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: propertyColor(properties, p) }} />{p}
                      </span>
                      <span style={{ fontWeight: 500 }}>{inr(Math.round(val))}</span>
                    </div>
                    <div style={{ fontSize: 11.5, color: TEXT_MUTED, marginTop: 2, marginLeft: 16 }}>
                      {inr(Math.round(airbnb))} Airbnb · {inr(Math.round(direct))} direct
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <PanelHeader>{drillMonth.label} bookings</PanelHeader>
          {drillMonth.items.length === 0 ? <EmptyNote text="No stays overlap this month." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {drillMonth.items.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                  <span>
                    <strong>{it.booking.guest}</strong> · {it.booking.property}
                    <span style={{ color: TEXT_MUTED }}> · {it.booking.checkIn} → {it.booking.checkOut}</span>
                    {it.spansMultiple && <span style={{ color: MUSTARD_DEEP }}> · {it.nights}/{it.totalNights} nights this month</span>}
                  </span>
                  <span style={{ fontWeight: 500, flexShrink: 0 }}>{inr(it.allocated)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExpensesTab({ expenses, properties, persistExpenses, userEmail, showToast }) {
  const [form, setForm] = useState(emptyExpenseForm());
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");
  const [view, setView] = useState("overall");
  const [selectedMonthKey, setSelectedMonthKey] = useState(null);
  const formRef = useRef(null);

  useEffect(() => {
    if (showForm && formRef.current) formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [showForm]);

  const resetForm = () => { setForm(emptyExpenseForm()); setShowForm(false); setFormError(""); };
  const editExpense = (e) => { setForm(e); setShowForm(true); setFormError(""); };
  const deleteExpense = (id, name) => {
    if (!window.confirm(`Delete the expense "${name || "this expense"}"? This can't be undone.`)) return;
    persistExpenses(expenses.filter((e) => e.id !== id));
    showToast("Expense deleted");
  };

  const submit = (ev) => {
    if (ev && ev.preventDefault) ev.preventDefault();
    if (!form.name.trim()) return setFormError("Expense name is required.");
    if (!form.amount || Number(form.amount) <= 0) return setFormError("Enter an amount greater than zero.");
    if (form.kind === "fixed" && !form.startDate) return setFormError("Start date is required for a fixed expense.");
    if (form.kind === "one_time" && !form.expenseDate) return setFormError("Date is required for a one-time expense.");
    setFormError("");
    const isNew = !form.id;
    const record = {
      ...form,
      id: form.id || (Date.now() + "-" + Math.random().toString(36).slice(2)),
      createdBy: isNew ? userEmail : form.createdBy || userEmail,
      updatedBy: userEmail,
    };
    const next = form.id ? expenses.map((e) => (e.id === form.id ? record : e)) : [...expenses, record];
    persistExpenses(next);
    resetForm();
    showToast(isNew ? "Expense added successfully" : "Expense updated successfully");
  };

  const currentMonthKey = monthKeyOf(todayStr());
  const fixed = expenses.filter((e) => e.kind === "fixed").sort((a, b) => a.name.localeCompare(b.name));
  const oneTime = expenses.filter((e) => e.kind === "one_time").sort((a, b) => (b.expenseDate || "").localeCompare(a.expenseDate || ""));
  const activeFixedTotal = fixed.reduce((s, e) => s + (fixedExpenseAppliesToMonthKey(e, currentMonthKey) ? Number(e.amount) || 0 : 0), 0);

  // Last 12 months of totals + the line items applicable to each, driving both the overall trend
  // chart and the "by month" drill-down below.
  const monthlyExpenses = useMemo(() => {
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" }),
        total: 0, items: [],
      });
    }
    months.forEach((m) => {
      expenses.forEach((exp) => {
        if (exp.kind === "fixed") {
          if (fixedExpenseAppliesToMonthKey(exp, m.key)) { m.total += Number(exp.amount) || 0; m.items.push(exp); }
        } else if (exp.expenseDate && monthKeyOf(exp.expenseDate) === m.key) {
          m.total += Number(exp.amount) || 0; m.items.push(exp);
        }
      });
    });
    return months;
  }, [expenses]);

  const currentMonthExpenses = monthlyExpenses[monthlyExpenses.length - 1];
  const drillInto = (key) => { setSelectedMonthKey(key); setView("monthly"); };
  const drillMonth = monthlyExpenses.find((m) => m.key === selectedMonthKey) || currentMonthExpenses;
  const drillMonthByCategory = expensesByCategory(drillMonth.items);

  const totalAllTime = useMemo(() => totalExpensesAllTime(expenses), [expenses]);
  const categoryAllTime = useMemo(
    () => expensesByCategory(expenses.map((e) => ({ category: e.category, amount: expenseAllTimeAmount(e) }))),
    [expenses]
  );

  return (
    <div>
      <SectionHeader title="Expenses" subtitle="Track fixed monthly costs and one-time expenses to see your real profit." />

      <button onClick={() => { setForm(emptyExpenseForm()); setShowForm(true); setFormError(""); }} style={{
        background: MUSTARD, color: INK, border: "none", padding: "10px 18px", borderRadius: 8,
        fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginBottom: 20,
      }}>
        <Plus size={16} /> New expense
      </button>

      {showForm && (
        <div ref={formRef} style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600 }}>{form.id ? "Edit expense" : "New expense"}</div>
            <button type="button" onClick={resetForm} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED }}><X size={18} /></button>
          </div>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10 }}>
              {[["fixed", "Fixed (recurring monthly)"], ["one_time", "One-time"]].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setForm((f) => ({ ...f, kind: val }))} style={{
                  flex: 1, padding: "10px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                  border: `1px solid ${form.kind === val ? MUSTARD : LINE}`,
                  background: form.kind === val ? "#FBF0DA" : "#fff", color: INK,
                }}>{label}</button>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
              <Field label="Name">
                <input style={inputStyle} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. WiFi, Cleaning" autoFocus />
              </Field>
              <Field label="Category">
                <select style={inputStyle} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label={form.kind === "fixed" ? "Amount / month" : "Amount"}>
                <input type="number" style={inputStyle} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="0" />
              </Field>
              <Field label="Property (optional)">
                <select style={inputStyle} value={form.property} onChange={(e) => setForm((f) => ({ ...f, property: e.target.value }))}>
                  <option value="">All properties</option>
                  {properties.map((p) => <option key={p}>{p}</option>)}
                </select>
              </Field>
              {form.kind === "fixed" ? (
                <>
                  <Field label="Starts">
                    <input type="date" style={inputStyle} value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </Field>
                  <Field label="Ends (optional)">
                    <input type="date" style={inputStyle} value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                  </Field>
                </>
              ) : (
                <Field label="Date">
                  <input type="date" style={inputStyle} value={form.expenseDate} onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))} />
                </Field>
              )}
            </div>
            <Field label="Notes (optional)">
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
            {formError && <div style={{ color: "#B6473F", fontSize: 13 }}>{formError}</div>}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" style={{
                background: MUSTARD, color: INK, border: "none", padding: "10px 20px", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>{form.id ? "Save changes" : "Add expense"}</button>
              <button type="button" onClick={resetForm} style={{
                background: "#fff", color: INK, border: `1px solid ${LINE}`, padding: "10px 20px", borderRadius: 8,
                fontSize: 14, fontWeight: 600, cursor: "pointer",
              }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        {[["overall", "Overall"], ["monthly", "By month"]].map(([val, label]) => (
          <button key={val} onClick={() => setView(val)} style={{
            padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 14, fontWeight: 600,
            border: `1px solid ${view === val ? MUSTARD : LINE}`,
            background: view === val ? "#FBF0DA" : "#fff", color: INK,
          }}>{label}</button>
        ))}
      </div>

      {view === "overall" ? (
        <>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <StatCard label="Fixed cost / month" value={inr(activeFixedTotal)} sub="currently active recurring expenses" />
            <StatCard label="Total expenses" value={inr(Math.round(totalAllTime))} accent={MUSTARD_DEEP} sub="all time" />
            <StatCard label="Expenses on record" value={expenses.length} />
          </div>

          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <PanelHeader>Last 12 months — total expenses — tap a bar to drill in</PanelHeader>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyExpenses} onClick={(e) => {
                if (e && typeof e.activeTooltipIndex === "number") drillInto(monthlyExpenses[e.activeTooltipIndex].key);
              }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LINE} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: TEXT_MUTED }} axisLine={{ stroke: LINE }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: TEXT_MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `₹${v >= 1000 ? (v / 1000) + "k" : v}`} />
                <Tooltip formatter={(v) => [inr(v), "Expenses"]} contentStyle={{ fontSize: 13, borderRadius: 8, border: `1px solid ${LINE}` }} />
                <Bar dataKey="total" fill={MUSTARD} radius={[4, 4, 0, 0]} cursor="pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
            <PanelHeader>By category (all time)</PanelHeader>
            {categoryAllTime.length === 0 ? <EmptyNote text="No expenses recorded yet." /> : categoryAllTime.map(([cat, val]) => (
              <div key={cat} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                <span>{cat}</span>
                <span style={{ fontWeight: 500 }}>{inr(Math.round(val))} <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>({Math.round((val / totalAllTime) * 100) || 0}%)</span></span>
              </div>
            ))}
          </div>

          <PanelHeader>Fixed expenses (recurring monthly)</PanelHeader>
          {fixed.length === 0 ? <EmptyNote text="No fixed expenses yet." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 24 }}>
              {fixed.map((e) => (
                <ExpenseRow key={e.id} e={e} onEdit={() => editExpense(e)} onDelete={() => deleteExpense(e.id, e.name)} detail={expenseDetailLine(e)} />
              ))}
            </div>
          )}

          <PanelHeader>One-time expenses</PanelHeader>
          {oneTime.length === 0 ? <EmptyNote text="No one-time expenses yet." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {oneTime.map((e) => (
                <ExpenseRow key={e.id} e={e} onEdit={() => editExpense(e)} onDelete={() => deleteExpense(e.id, e.name)} detail={expenseDetailLine(e)} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <PanelHeader>Month</PanelHeader>
            <select value={drillMonth.key} onChange={(e) => setSelectedMonthKey(e.target.value)} style={{ ...inputStyle, width: 160 }}>
              {monthlyExpenses.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <StatCard label="Total expenses" value={inr(Math.round(drillMonth.total))} accent={MUSTARD_DEEP} />
            <StatCard label="Line items" value={drillMonth.items.length} />
          </div>

          <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 10, padding: 20, marginBottom: 24 }}>
            <PanelHeader>By category this month</PanelHeader>
            {drillMonthByCategory.length === 0 ? <EmptyNote text="No expenses this month." /> : drillMonthByCategory.map(([cat, val]) => (
              <div key={cat} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "7px 0", borderBottom: `1px solid ${PAPER_DIM}` }}>
                <span>{cat}</span>
                <span style={{ fontWeight: 500 }}>{inr(Math.round(val))}</span>
              </div>
            ))}
          </div>

          <PanelHeader>{drillMonth.label} expenses</PanelHeader>
          {drillMonth.items.length === 0 ? <EmptyNote text="No expenses this month." /> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {drillMonth.items.map((e) => (
                <ExpenseRow key={e.id} e={e} onEdit={() => editExpense(e)} onDelete={() => deleteExpense(e.id, e.name)} detail={expenseDetailLine(e)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExpenseRow({ e, onEdit, onDelete, detail }) {
  return (
    <div style={{
      background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{e.name} <span style={{ color: TEXT_MUTED, fontWeight: 400 }}>· {e.category}</span>{e.property && <span style={{ color: TEXT_MUTED, fontWeight: 400 }}> · {e.property}</span>}</div>
        <div style={{ fontSize: 12.5, color: TEXT_MUTED }}>{detail}</div>
      </div>
      <button onClick={onEdit} style={{ background: "none", border: "none", cursor: "pointer", color: TEXT_MUTED, padding: 6 }}><Pencil size={15} /></button>
      <button onClick={onDelete} style={{ background: "none", border: "none", cursor: "pointer", color: "#B6473F", padding: 6 }}><Trash2 size={15} /></button>
    </div>
  );
}
