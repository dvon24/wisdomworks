/**
 * Business Type Framework Dictionary
 *
 * Structured profiles for 20+ business types. The Axis team uses these
 * to rapidly scaffold AxisDeploymentSpecs during onboarding.
 * The dictionary grows from successful deployments — every new business
 * type onboarded becomes a reusable framework.
 */

export interface BusinessTypeFramework {
  id: string;
  name: string;
  category: BusinessCategory;
  description: string;
  typicalWorkflows: string[];
  clientInteractionPatterns: string[];
  seasonalRhythms: string[];
  commonIntegrations: string[];
  requiredAgentRoles: string[];
  recommendedOutputChannels: string[];
  visualIntelligence: boolean;
  clientProfileStructure: string[];
  keyMetrics: string[];
}

export type BusinessCategory =
  | 'skilled_trades'
  | 'personal_services'
  | 'food_hospitality'
  | 'professional_services'
  | 'healthcare'
  | 'retail'
  | 'creative_services'
  | 'construction_maintenance';

export const BUSINESS_CATEGORIES: Record<BusinessCategory, string> = {
  skilled_trades: 'Skilled Trades',
  personal_services: 'Personal Services',
  food_hospitality: 'Food & Hospitality',
  professional_services: 'Professional Services',
  healthcare: 'Healthcare',
  retail: 'Retail',
  creative_services: 'Creative Services',
  construction_maintenance: 'Construction & Maintenance',
};

/**
 * The dictionary — seed data for 20+ business types.
 * Extensible: new types added without code changes.
 */
export const BUSINESS_TYPE_DICTIONARY: BusinessTypeFramework[] = [
  // SKILLED TRADES
  {
    id: 'electrician',
    name: 'Electrician',
    category: 'skilled_trades',
    description: 'Residential/commercial electrical services',
    typicalWorkflows: ['job_scheduling', 'estimate_generation', 'invoicing', 'permit_tracking'],
    clientInteractionPatterns: ['phone_call_booking', 'onsite_assessment', 'followup_quote'],
    seasonalRhythms: ['summer_ac_installs', 'holiday_lighting', 'spring_inspections'],
    commonIntegrations: ['calendar', 'invoicing', 'gps_routing'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'invoicing'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['property_type', 'electrical_panel', 'service_history', 'photos'],
    keyMetrics: ['jobs_per_week', 'avg_ticket_size', 'repeat_client_rate', 'response_time'],
  },
  {
    id: 'plumber',
    name: 'Plumber',
    category: 'skilled_trades',
    description: 'Plumbing installation and repair services',
    typicalWorkflows: ['emergency_dispatch', 'job_scheduling', 'parts_ordering', 'invoicing'],
    clientInteractionPatterns: ['emergency_calls', 'scheduled_maintenance', 'warranty_followup'],
    seasonalRhythms: ['winter_pipe_bursts', 'spring_sewer_issues', 'fall_winterization'],
    commonIntegrations: ['calendar', 'invoicing', 'parts_inventory'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['property_type', 'plumbing_system', 'service_history', 'photos'],
    keyMetrics: ['jobs_per_week', 'emergency_response_time', 'avg_ticket_size'],
  },
  {
    id: 'hvac_tech',
    name: 'HVAC Technician',
    category: 'skilled_trades',
    description: 'Heating, ventilation, and air conditioning',
    typicalWorkflows: ['seasonal_maintenance', 'installation', 'emergency_repair', 'energy_audit'],
    clientInteractionPatterns: ['seasonal_reminders', 'emergency_calls', 'maintenance_contracts'],
    seasonalRhythms: ['spring_ac_tuneup', 'fall_heating_prep', 'summer_peak', 'winter_emergencies'],
    commonIntegrations: ['calendar', 'invoicing', 'equipment_tracking'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['property_type', 'hvac_system', 'maintenance_history', 'warranty_info'],
    keyMetrics: ['maintenance_contracts', 'emergency_calls', 'seasonal_revenue'],
  },

  // PERSONAL SERVICES
  {
    id: 'hair_stylist',
    name: 'Hair Stylist / Salon',
    category: 'personal_services',
    description: 'Hair cutting, coloring, and styling services',
    typicalWorkflows: ['appointment_booking', 'client_preferences', 'product_recommendations', 'promotions'],
    clientInteractionPatterns: ['recurring_appointments', 'style_consultations', 'referral_program'],
    seasonalRhythms: ['prom_season', 'wedding_season', 'holiday_parties', 'back_to_school'],
    commonIntegrations: ['calendar', 'payment_processing', 'social_media'],
    requiredAgentRoles: ['scheduler', 'marketing', 'website_manager', 'customer_service'],
    recommendedOutputChannels: ['whatsapp', 'sms', 'voice', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['hair_type', 'preferred_styles', 'color_history', 'allergies', 'photos'],
    keyMetrics: ['bookings_per_day', 'avg_service_value', 'retention_rate', 'no_show_rate'],
  },
  {
    id: 'barber',
    name: 'Barber',
    category: 'personal_services',
    description: 'Men\'s grooming and barbering services',
    typicalWorkflows: ['walk_in_management', 'appointment_booking', 'wait_list', 'promotions'],
    clientInteractionPatterns: ['regular_schedule', 'walk_ins', 'loyalty_tracking'],
    seasonalRhythms: ['back_to_school', 'holiday_grooming', 'graduation_season'],
    commonIntegrations: ['calendar', 'payment_processing'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['whatsapp', 'sms', 'voice', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['cut_preference', 'frequency', 'products_used', 'photos'],
    keyMetrics: ['clients_per_day', 'avg_ticket', 'retention_rate', 'walk_in_vs_booked'],
  },
  {
    id: 'cosmetician',
    name: 'Cosmetician / Esthetician',
    category: 'personal_services',
    description: 'Skincare, beauty treatments, and cosmetic services',
    typicalWorkflows: ['skin_assessment', 'treatment_planning', 'product_recommendations', 'followup_care'],
    clientInteractionPatterns: ['consultation_booking', 'treatment_series', 'product_reorders'],
    seasonalRhythms: ['wedding_season', 'holiday_parties', 'summer_skincare', 'winter_hydration'],
    commonIntegrations: ['calendar', 'payment_processing', 'product_inventory'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'website_manager'],
    recommendedOutputChannels: ['whatsapp', 'sms', 'voice', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['skin_type', 'allergies', 'treatment_history', 'before_after_photos'],
    keyMetrics: ['bookings_per_day', 'treatment_completion_rate', 'product_sales', 'retention'],
  },
  {
    id: 'personal_trainer',
    name: 'Personal Trainer',
    category: 'personal_services',
    description: 'Fitness training and wellness coaching',
    typicalWorkflows: ['session_scheduling', 'workout_planning', 'progress_tracking', 'nutrition_guidance'],
    clientInteractionPatterns: ['recurring_sessions', 'goal_reviews', 'motivation_check_ins'],
    seasonalRhythms: ['new_year_resolutions', 'summer_body', 'fall_restart'],
    commonIntegrations: ['calendar', 'payment_processing', 'fitness_tracking'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['whatsapp', 'sms', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['fitness_goals', 'injuries', 'progress_photos', 'measurements'],
    keyMetrics: ['sessions_per_week', 'client_retention', 'goal_achievement_rate'],
  },

  // FOOD & HOSPITALITY
  {
    id: 'restaurant',
    name: 'Restaurant',
    category: 'food_hospitality',
    description: 'Full-service or fast-casual dining',
    typicalWorkflows: ['reservation_management', 'review_monitoring', 'menu_updates', 'promotions'],
    clientInteractionPatterns: ['reservations', 'takeout_orders', 'review_responses', 'loyalty'],
    seasonalRhythms: ['valentines', 'mothers_day', 'holiday_parties', 'summer_patio'],
    commonIntegrations: ['reservation_system', 'review_platforms', 'social_media', 'delivery_apps'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'website_manager'],
    recommendedOutputChannels: ['voice', 'whatsapp', 'sms'],
    visualIntelligence: false,
    clientProfileStructure: ['dining_preferences', 'allergies', 'visit_frequency', 'avg_spend'],
    keyMetrics: ['covers_per_day', 'avg_check', 'review_rating', 'reservation_no_show_rate'],
  },
  {
    id: 'cafe',
    name: 'Cafe / Coffee Shop',
    category: 'food_hospitality',
    description: 'Coffee, beverages, and light fare',
    typicalWorkflows: ['loyalty_program', 'seasonal_menu', 'event_hosting', 'social_media'],
    clientInteractionPatterns: ['daily_regulars', 'mobile_ordering', 'catering_requests'],
    seasonalRhythms: ['pumpkin_spice_fall', 'holiday_drinks', 'summer_cold_brew'],
    commonIntegrations: ['pos_system', 'social_media', 'loyalty_platform'],
    requiredAgentRoles: ['marketing', 'customer_service'],
    recommendedOutputChannels: ['whatsapp', 'sms'],
    visualIntelligence: false,
    clientProfileStructure: ['favorite_drinks', 'visit_frequency', 'dietary_preferences'],
    keyMetrics: ['daily_transactions', 'avg_ticket', 'loyalty_member_rate'],
  },

  // PROFESSIONAL SERVICES
  {
    id: 'consulting_firm',
    name: 'Consulting Firm',
    category: 'professional_services',
    description: 'Management, technology, or strategy consulting',
    typicalWorkflows: ['engagement_management', 'deliverable_production', 'client_reporting', 'knowledge_management'],
    clientInteractionPatterns: ['engagement_kickoff', 'weekly_status', 'deliverable_review', 'executive_briefing'],
    seasonalRhythms: ['budget_season_q4', 'new_year_planning', 'mid_year_review'],
    commonIntegrations: ['email', 'calendar', 'project_management', 'document_management', 'crm'],
    requiredAgentRoles: ['founder', 'cto', 'project_manager', 'business_analyst', 'marketing', 'qa', 'hr', 'finance'],
    recommendedOutputChannels: ['email', 'dashboard', 'desktop'],
    visualIntelligence: false,
    clientProfileStructure: ['engagement_history', 'stakeholders', 'deliverables', 'satisfaction_scores'],
    keyMetrics: ['utilization_rate', 'revenue_per_engagement', 'client_satisfaction', 'repeat_business'],
  },
  {
    id: 'law_firm',
    name: 'Law Firm',
    category: 'professional_services',
    description: 'Legal services and representation',
    typicalWorkflows: ['case_management', 'billing_tracking', 'document_drafting', 'court_scheduling'],
    clientInteractionPatterns: ['initial_consultation', 'case_updates', 'document_review', 'billing'],
    seasonalRhythms: ['tax_season_q1', 'fiscal_year_end', 'court_calendar_cycles'],
    commonIntegrations: ['case_management', 'billing', 'document_management', 'calendar'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'document_manager'],
    recommendedOutputChannels: ['email', 'voice', 'dashboard'],
    visualIntelligence: false,
    clientProfileStructure: ['case_type', 'case_history', 'billing_status', 'key_dates'],
    keyMetrics: ['billable_hours', 'case_win_rate', 'client_acquisition_cost', 'collection_rate'],
  },
  {
    id: 'accounting_firm',
    name: 'Accounting Firm',
    category: 'professional_services',
    description: 'Tax preparation, bookkeeping, and financial advisory',
    typicalWorkflows: ['tax_preparation', 'bookkeeping', 'financial_reporting', 'audit_support'],
    clientInteractionPatterns: ['tax_season_rush', 'quarterly_reviews', 'year_end_planning'],
    seasonalRhythms: ['tax_deadline_april', 'extension_october', 'year_end_q4', 'quarterly_estimates'],
    commonIntegrations: ['accounting_software', 'tax_software', 'document_management', 'calendar'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'document_manager'],
    recommendedOutputChannels: ['email', 'voice', 'dashboard'],
    visualIntelligence: false,
    clientProfileStructure: ['tax_status', 'filing_history', 'financial_complexity', 'key_deadlines'],
    keyMetrics: ['returns_filed', 'avg_fee', 'client_retention', 'deadline_compliance'],
  },
  {
    id: 'real_estate_office',
    name: 'Real Estate Office',
    category: 'professional_services',
    description: 'Residential or commercial real estate brokerage',
    typicalWorkflows: ['lead_tracking', 'showing_coordination', 'offer_management', 'closing_process'],
    clientInteractionPatterns: ['lead_response', 'property_showings', 'offer_negotiation', 'closing_coordination'],
    seasonalRhythms: ['spring_selling_season', 'summer_peak', 'fall_slowdown', 'year_end_closings'],
    commonIntegrations: ['mls', 'crm', 'calendar', 'document_signing', 'marketing_platforms'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'lead_manager'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'email', 'calendar'],
    visualIntelligence: false,
    clientProfileStructure: ['buyer_seller', 'budget_range', 'preferences', 'showing_history', 'offer_status'],
    keyMetrics: ['leads_per_month', 'showing_to_offer_ratio', 'avg_days_on_market', 'commission_revenue'],
  },

  // HEALTHCARE
  {
    id: 'dentist',
    name: 'Dentist',
    category: 'healthcare',
    description: 'General and cosmetic dentistry',
    typicalWorkflows: ['appointment_scheduling', 'treatment_planning', 'insurance_verification', 'recall_reminders'],
    clientInteractionPatterns: ['biannual_cleanings', 'treatment_consultations', 'emergency_visits'],
    seasonalRhythms: ['back_to_school_checkups', 'year_end_insurance', 'summer_cosmetic'],
    commonIntegrations: ['practice_management', 'insurance_verification', 'calendar', 'patient_portal'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['dental_history', 'insurance', 'treatment_plan', 'xrays'],
    keyMetrics: ['patients_per_day', 'treatment_acceptance_rate', 'recall_compliance', 'production_per_visit'],
  },
  {
    id: 'chiropractor',
    name: 'Chiropractor',
    category: 'healthcare',
    description: 'Chiropractic care and wellness',
    typicalWorkflows: ['initial_assessment', 'treatment_plan', 'recurring_visits', 'wellness_programs'],
    clientInteractionPatterns: ['initial_consultation', 'regular_adjustments', 'wellness_check_ins'],
    seasonalRhythms: ['new_year_wellness', 'sports_season_injuries', 'winter_posture'],
    commonIntegrations: ['practice_management', 'calendar', 'insurance'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'calendar'],
    visualIntelligence: false,
    clientProfileStructure: ['condition', 'treatment_plan', 'visit_history', 'progress_notes'],
    keyMetrics: ['visits_per_week', 'patient_retention', 'treatment_completion_rate'],
  },

  // RETAIL
  {
    id: 'retail_shop',
    name: 'Retail Shop',
    category: 'retail',
    description: 'Brick-and-mortar retail store',
    typicalWorkflows: ['inventory_management', 'customer_loyalty', 'promotions', 'online_presence'],
    clientInteractionPatterns: ['in_store_assistance', 'online_orders', 'returns', 'loyalty_rewards'],
    seasonalRhythms: ['holiday_season', 'back_to_school', 'spring_clearance', 'black_friday'],
    commonIntegrations: ['pos_system', 'inventory', 'ecommerce', 'social_media'],
    requiredAgentRoles: ['marketing', 'customer_service', 'website_manager', 'inventory_manager'],
    recommendedOutputChannels: ['whatsapp', 'sms', 'email'],
    visualIntelligence: false,
    clientProfileStructure: ['purchase_history', 'preferences', 'loyalty_status', 'contact_info'],
    keyMetrics: ['daily_sales', 'avg_transaction', 'inventory_turnover', 'customer_return_rate'],
  },

  // CREATIVE SERVICES
  {
    id: 'photography_studio',
    name: 'Photography Studio',
    category: 'creative_services',
    description: 'Portrait, event, and commercial photography',
    typicalWorkflows: ['session_booking', 'shoot_planning', 'photo_editing', 'delivery', 'album_creation'],
    clientInteractionPatterns: ['consultation', 'session_prep', 'proof_review', 'print_ordering'],
    seasonalRhythms: ['wedding_season', 'holiday_portraits', 'graduation', 'fall_foliage'],
    commonIntegrations: ['calendar', 'gallery_platform', 'payment_processing', 'social_media'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['whatsapp', 'email', 'voice', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['session_type', 'style_preferences', 'gallery_links', 'print_orders'],
    keyMetrics: ['sessions_per_month', 'avg_package_value', 'referral_rate', 'gallery_views'],
  },

  // CONSTRUCTION & MAINTENANCE
  {
    id: 'construction_company',
    name: 'Construction Company',
    category: 'construction_maintenance',
    description: 'General contracting, remodeling, and construction',
    typicalWorkflows: ['project_estimation', 'scheduling', 'subcontractor_management', 'permit_tracking', 'invoicing'],
    clientInteractionPatterns: ['initial_estimate', 'project_updates', 'change_orders', 'final_walkthrough'],
    seasonalRhythms: ['spring_start', 'summer_peak', 'fall_completion', 'winter_planning'],
    commonIntegrations: ['project_management', 'calendar', 'invoicing', 'permit_systems'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service', 'project_manager'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'email', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['project_type', 'budget', 'timeline', 'progress_photos', 'permits'],
    keyMetrics: ['active_projects', 'avg_project_value', 'on_time_completion', 'profit_margin'],
  },
  {
    id: 'auto_mechanic',
    name: 'Auto Mechanic',
    category: 'construction_maintenance',
    description: 'Automotive repair and maintenance',
    typicalWorkflows: ['appointment_booking', 'diagnostic', 'repair_authorization', 'parts_ordering', 'pickup_notification'],
    clientInteractionPatterns: ['drop_off', 'diagnostic_report', 'authorization_call', 'pickup_ready'],
    seasonalRhythms: ['winter_prep', 'spring_maintenance', 'summer_road_trips', 'tire_change_seasons'],
    commonIntegrations: ['shop_management', 'parts_catalog', 'calendar', 'invoicing'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['voice', 'sms', 'whatsapp', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['vehicle_info', 'service_history', 'diagnostic_photos', 'maintenance_schedule'],
    keyMetrics: ['cars_per_day', 'avg_repair_order', 'parts_margin', 'customer_return_rate'],
  },
  {
    id: 'landscaper',
    name: 'Landscaper',
    category: 'construction_maintenance',
    description: 'Lawn care, landscaping, and outdoor maintenance',
    typicalWorkflows: ['route_planning', 'seasonal_services', 'estimate_generation', 'recurring_scheduling'],
    clientInteractionPatterns: ['seasonal_contracts', 'one_time_projects', 'weather_rescheduling'],
    seasonalRhythms: ['spring_cleanup', 'summer_mowing', 'fall_leaf_removal', 'winter_snow_plowing'],
    commonIntegrations: ['route_optimization', 'calendar', 'invoicing', 'weather_api'],
    requiredAgentRoles: ['scheduler', 'marketing', 'customer_service'],
    recommendedOutputChannels: ['sms', 'whatsapp', 'voice', 'calendar'],
    visualIntelligence: true,
    clientProfileStructure: ['property_size', 'services_contracted', 'schedule', 'before_after_photos'],
    keyMetrics: ['properties_per_day', 'recurring_revenue', 'seasonal_revenue_mix', 'route_efficiency'],
  },
];

/** Look up a business type by ID */
export function getBusinessType(id: string): BusinessTypeFramework | undefined {
  return BUSINESS_TYPE_DICTIONARY.find((bt) => bt.id === id);
}

/** Get all business types in a category */
export function getBusinessTypesByCategory(category: BusinessCategory): BusinessTypeFramework[] {
  return BUSINESS_TYPE_DICTIONARY.filter((bt) => bt.category === category);
}
