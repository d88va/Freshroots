import { redirect } from "next/navigation";

// The work starts at Review.
export default function Home() {
  redirect("/review");
}
