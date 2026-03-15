import { iapJsonError } from "../../../../lib/iap/errors";
import { listProducts } from "../../../../lib/iap/service";

export async function GET() {
  try {
    const products = await listProducts();
    return Response.json({ ok: true, products });
  } catch (e) {
    return iapJsonError(e);
  }
}

