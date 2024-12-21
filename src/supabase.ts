import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

import { Database } from "./types/supabase";
import { Database as HoneySupabase } from "./types/honeySupabase";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);

export const honeySupabase = createClient<HoneySupabase>(
  process.env.HONEYJAR_SUPABASE_URL || "",
  process.env.HONEYJAR_SUPABASE_KEY || ""
);
