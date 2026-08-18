| column_name                | data_type                   | is_nullable | column_default    |
| -------------------------- | --------------------------- | ----------- | ----------------- |
| id                         | text                        | NO          | null              |
| stakeholder_id             | text                        | NO          | null              |
| enumerator_id              | text                        | NO          | null              |
| contact_person             | text                        | YES         | null              |
| designation                | text                        | YES         | null              |
| mobile_number              | text                        | YES         | null              |
| email                      | text                        | YES         | null              |
| website                    | text                        | YES         | null              |
| business_category          | text                        | YES         | null              |++
| notes                      | text                        | YES         | null              |
| gst_number                 | text                        | YES         | null              |
| organization_type          | text                        | YES         | null              |
| remarks                    | text                        | YES         | null              |
| latitude                   | double precision            | YES         | null              |
| longitude                  | double precision            | YES         | null              |
| gps_accuracy               | double precision            | YES         | null              |
| is_draft                   | boolean                     | NO          | true              |
| is_completed               | boolean                     | NO          | false             |
| is_synced                  | boolean                     | NO          | false             |
| local_id                   | text                        | YES         | null              |
| completed_at               | timestamp without time zone | YES         | null              |
| synced_at                  | timestamp without time zone | YES         | null              |
| created_at                 | timestamp without time zone | NO          | CURRENT_TIMESTAMP |
| updated_at                 | timestamp without time zone | NO          | null              |
| nearest_healthcare_center  | text                        | YES         | null              |
| nearest_police_station     | text                        | YES         | null              |
| contact_person_2           | text                        | YES         | null              |
| email_2                    | text                        | YES         | null              |
| mobile_number_2            | text                        | YES         | null              |
| digipin                    | text                        | YES         | null              |
| sub_categories             | ARRAY                       | YES         | '{}'::text[]      | ///
| business_name              | text                        | YES         | null              | ///
| owner_name                 | text                        | YES         | null              | ///
| district                   | text                        | YES         | null              | ///
| city                       | text                        | YES         | null              | ///
| taluka                     | text                        | YES         | null              | ///
| village                    | text                        | YES         | null              |
| pin_code                   | text                        | YES         | null              | ///
| business_address           | text                        | YES         | null              | ///
| working_address            | text                        | YES         | null              |
| male_employees             | integer                     | YES         | null              |
| female_employees           | integer                     | YES         | null              |
| landline                   | text                        | YES         | null              |
| alternate_mobile           | text                        | YES         | null              |
| alternate_email            | text                        | YES         | null              |
| aadhar_number              | text                        | YES         | null              |
| udyam_aadhar_reg_no        | text                        | YES         | null              |
| fssai_number               | text                        | YES         | null              |
| description                | text                        | YES         | null              |
| accommodation_facilities   | jsonb                       | YES         | null              |
| accommodation_policies     | text                        | YES         | null              |
| working_hours              | jsonb                       | YES         | null              |
| faq                        | jsonb                       | YES         | null              |
| rooms                      | jsonb                       | YES         | null              |
| coupon_codes               | jsonb                       | YES         | null              |
| sale_off                   | double precision            | YES         | null              |
| additional_service_fees    | jsonb                       | YES         | null              |
| booking_note               | text                        | YES         | null              |
| social_links               | jsonb                       | YES         | null              |
| about_business             | text                        | YES         | null              |
| registered_travel_for_life | boolean                     | NO          | false             |
| registered_green_leaf      | boolean                     | NO          | false             |
| received_tourism_award     | boolean                     | NO          | false             |
| custom_documents           | jsonb                       | YES         | null              |
| agreed_to_terms            | boolean                     | NO          | false             |
| declared_info_correct      | boolean                     | NO          | false             |
| acknowledged_dot_liability | boolean                     | NO          | false             |
| pan_number                 | text                        | YES         | null              |
| establishment_cert_no      | text                        | YES         | null              |