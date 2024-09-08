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
