// Retired endpoint: reject old clients before reading requests or loading providers.
import { userBankRetiredResponse } from "../../../../lib/userBank/retired";

export async function POST() {
  return userBankRetiredResponse();
}
