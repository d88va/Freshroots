"use client";

export default function PrintButton() {
  return <button className="secondary" onClick={() => window.print()}>Print or save as PDF</button>;
}
