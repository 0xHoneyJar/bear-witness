import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

import { Database } from "./types/supabase";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
