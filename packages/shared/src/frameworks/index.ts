export {
  BUSINESS_TYPE_DICTIONARY,
  BUSINESS_CATEGORIES,
  getBusinessType,
  getBusinessTypesByCategory,
} from './business-types';
export type { BusinessTypeFramework, BusinessCategory } from './business-types';

export {
  INDUSTRY_TEMPLATES,
  PROFESSIONAL_SERVICES_TEMPLATE,
  SMALL_BUSINESS_TEMPLATE,
  getTemplate,
  findTemplateForBusiness,
} from './industry-templates';
export type { IndustryTemplate } from './industry-templates';

export {
  PERSONAL_TEMPLATES,
  PERSONAL_BLUEPRINTS,
  getPersonalTemplate,
} from './personal-templates';
export type { PersonalTemplate } from './personal-templates';
