export interface Step {
  type: StepType | string;
  verificationType?: VerifyType | string;
  orGroup?: string;
  // Add other properties as needed
}

export enum StepType {
  Mint = "Mint",
  Onchain = "Onchain",
  Wait = "Wait",
  Verify = "Verify",
  Logout = "Logout",
  Watch = "Watch",
  // Add other step types as needed
}

export enum VerifyType {
  Farcaster = "Farcaster",
  Onchain = "Onchain",
  Manual = "Manual",
  Referrals = "Referrals",
  // Add other verification types as needed
}

export interface PartnershipTier {
  name: string;
  fullName: string;
  percentage: number;
}

export interface OnchainMint {
  address: string;
  timestamp: number;
  questName: string;
  amount: number;
  stepNumber: number; // Add this line
}

export interface WebsiteVisit {
  address: string;
  timestamp: number;
  questName: string;
}

export interface Quest {
  id: string;
  title: string;
  steps: any[]; // Replace 'any' with a more specific type if available
  tracked_steps: number[];
}
