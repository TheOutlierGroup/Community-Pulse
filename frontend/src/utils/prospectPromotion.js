import {
  CLIENT_SERVICE_PULSE,
  CLIENT_SERVICE_ADOPTION_ACCELERATOR,
  CLIENT_SERVICE_PROJECT_RESOURCES,
  CLIENT_SERVICE_OG_SKATE_OTHER,
  CLIENT_SERVICE_HUMAN_AI,
  CLIENT_SERVICE_ET_INC,
} from './clientServices.js';

// Business Unit (CRM Prospects) -> Service (Clients) mapping used to prefill
// the New Client modal when promoting a prospect. "Outlier Core" becomes
// "Project Resources" per the CRM-to-Client naming convention; "Outlier
// Skate" has no single matching service (there are 4 separate OG Skate
// services) so it defaults to "OG Skate - Other" and staff pick the exact
// one before creating the client.
const BUSINESS_UNIT_TO_SERVICE_ID = {
  'Outlier Core': CLIENT_SERVICE_PROJECT_RESOURCES,
  'Outlier Skate': CLIENT_SERVICE_OG_SKATE_OTHER,
  'Rhythm Engine': CLIENT_SERVICE_PULSE,
  'Adoption Accelerator': CLIENT_SERVICE_ADOPTION_ACCELERATOR,
  'AI-Human Workforce Design': CLIENT_SERVICE_HUMAN_AI,
  'ET Inc': CLIENT_SERVICE_ET_INC,
};

export function serviceIdForBusinessUnit(businessUnit) {
  return BUSINESS_UNIT_TO_SERVICE_ID[businessUnit] || null;
}
