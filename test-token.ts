import { createMobileToken } from "./src/lib/rti-storage";

async function test() {
  try {
    const t = await createMobileToken("manual-edit", 120);
    console.log("Success string:", t);
  } catch (e) {
    console.error("String error:", (e as Error).message);
  }
  
  try {
    const uuid = "00000000-0000-0000-0000-000000000000";
    const t2 = await createMobileToken(uuid, 120);
    console.log("Success UUID:", t2);
  } catch (e) {
    console.error("UUID error:", (e as Error).message);
  }
}
test();
