--
-- PostgreSQL database dump
--

\restrict x5stHJhaoKgGdRXEnC6b58WoTehCOixtRKg3hY1G0u9FD5doaF01NfRYBdafEbb

-- Dumped from database version 18.2
-- Dumped by pg_dump version 18.2

-- Started on 2026-08-11 14:25:04

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 11 (class 2615 OID 143320)
-- Name: geography; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA geography;


ALTER SCHEMA geography OWNER TO postgres;

--
-- TOC entry 7 (class 2615 OID 142345)
-- Name: identityaccess; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA identityaccess;


ALTER SCHEMA identityaccess OWNER TO postgres;

--
-- TOC entry 8 (class 2615 OID 142448)
-- Name: listing; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA listing;


ALTER SCHEMA listing OWNER TO postgres;

--
-- TOC entry 5 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- TOC entry 5637 (class 0 OID 0)
-- Dependencies: 5
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 302 (class 1259 OID 143321)
-- Name: countries; Type: TABLE; Schema: geography; Owner: postgres
--

CREATE TABLE geography.countries (
    id uuid NOT NULL,
    name character varying(100) NOT NULL,
    code character varying(10) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE geography.countries OWNER TO postgres;

--
-- TOC entry 304 (class 1259 OID 143345)
-- Name: districts; Type: TABLE; Schema: geography; Owner: postgres
--

CREATE TABLE geography.districts (
    id uuid NOT NULL,
    state_id uuid,
    name character varying(100) NOT NULL,
    division character varying(100),
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE geography.districts OWNER TO postgres;

--
-- TOC entry 303 (class 1259 OID 143331)
-- Name: states; Type: TABLE; Schema: geography; Owner: postgres
--

CREATE TABLE geography.states (
    id uuid NOT NULL,
    country_id uuid,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE geography.states OWNER TO postgres;

--
-- TOC entry 305 (class 1259 OID 143359)
-- Name: talukas; Type: TABLE; Schema: geography; Owner: postgres
--

CREATE TABLE geography.talukas (
    id uuid NOT NULL,
    district_id uuid,
    name character varying(100) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE geography.talukas OWNER TO postgres;

--
-- TOC entry 235 (class 1259 OID 142435)
-- Name: admin_districts; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.admin_districts (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    district_id uuid NOT NULL
);


ALTER TABLE identityaccess.admin_districts OWNER TO postgres;

--
-- TOC entry 229 (class 1259 OID 142346)
-- Name: roles; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE identityaccess.roles OWNER TO postgres;

--
-- TOC entry 230 (class 1259 OID 142355)
-- Name: users; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid,
    name character varying,
    mobile character varying(20) NOT NULL,
    email character varying NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    password_salt character varying NOT NULL,
    reset_token character varying,
    reset_token_expires timestamp without time zone
);


ALTER TABLE identityaccess.users OWNER TO postgres;

--
-- TOC entry 313 (class 1259 OID 143496)
-- Name: mv_user_roles; Type: MATERIALIZED VIEW; Schema: identityaccess; Owner: postgres
--

CREATE MATERIALIZED VIEW identityaccess.mv_user_roles AS
 SELECT u.id AS user_id,
    u.name AS username,
    u.first_name,
    u.last_name,
    u.email,
    u.mobile,
    u.is_active,
    r.id AS role_id,
    r.name AS role_name,
    u.created_at AS user_created_at,
    u.updated_at AS user_updated_at
   FROM (identityaccess.users u
     LEFT JOIN identityaccess.roles r ON ((u.role_id = r.id)))
  WITH NO DATA;


ALTER MATERIALIZED VIEW identityaccess.mv_user_roles OWNER TO postgres;

--
-- TOC entry 231 (class 1259 OID 142383)
-- Name: permissions; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.permissions (
    id uuid NOT NULL,
    name character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE identityaccess.permissions OWNER TO postgres;

--
-- TOC entry 233 (class 1259 OID 142406)
-- Name: profile; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.profile (
    id uuid NOT NULL,
    user_id uuid,
    avatar_url character varying(255),
    bio text,
    address text,
    city_id character varying(100),
    state_id character varying(100) DEFAULT 'Maharashtra'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE identityaccess.profile OWNER TO postgres;

--
-- TOC entry 232 (class 1259 OID 142391)
-- Name: role_permissions; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


ALTER TABLE identityaccess.role_permissions OWNER TO postgres;

--
-- TOC entry 306 (class 1259 OID 143373)
-- Name: user_division_assignments; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.user_division_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    division character varying(100) NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE identityaccess.user_division_assignments OWNER TO postgres;

--
-- TOC entry 234 (class 1259 OID 142422)
-- Name: user_listings_saves; Type: TABLE; Schema: identityaccess; Owner: postgres
--

CREATE TABLE identityaccess.user_listings_saves (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    listing_id uuid NOT NULL
);


ALTER TABLE identityaccess.user_listings_saves OWNER TO postgres;

--
-- TOC entry 251 (class 1259 OID 142650)
-- Name: accommodations_rooms; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.accommodations_rooms (
    id uuid NOT NULL,
    listing_id uuid,
    room_title character varying,
    price real,
    room_quantity integer,
    children_capacity integer,
    adult_capacity integer,
    description text,
    minimum_nights_required_booking integer
);


ALTER TABLE listing.accommodations_rooms OWNER TO postgres;

--
-- TOC entry 254 (class 1259 OID 142682)
-- Name: accommodations_rooms_accommodations_rooms_facilities; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.accommodations_rooms_accommodations_rooms_facilities (
    accommodations_rooms_id uuid,
    accommodations_rooms_facility_id uuid
);


ALTER TABLE listing.accommodations_rooms_accommodations_rooms_facilities OWNER TO postgres;

--
-- TOC entry 256 (class 1259 OID 142703)
-- Name: accommodations_rooms_accommodations_rooms_photos; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.accommodations_rooms_accommodations_rooms_photos (
    accommodations_rooms_id uuid,
    accommodations_rooms_photos_id uuid
);


ALTER TABLE listing.accommodations_rooms_accommodations_rooms_photos OWNER TO postgres;

--
-- TOC entry 252 (class 1259 OID 142663)
-- Name: accommodations_rooms_availability_dates; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.accommodations_rooms_availability_dates (
    id uuid NOT NULL,
    accommodations_rooms_id uuid,
    date date,
    lock_room_quantity integer,
    price real
);


ALTER TABLE listing.accommodations_rooms_availability_dates OWNER TO postgres;

--
-- TOC entry 253 (class 1259 OID 142674)
-- Name: accommodations_rooms_facilities; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.accommodations_rooms_facilities (
    id uuid NOT NULL,
    facilitiy character varying
);


ALTER TABLE listing.accommodations_rooms_facilities OWNER TO postgres;

--
-- TOC entry 255 (class 1259 OID 142695)
-- Name: accommodations_rooms_photos; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.accommodations_rooms_photos (
    id uuid NOT NULL,
    image_url character varying,
    featured boolean
);


ALTER TABLE listing.accommodations_rooms_photos OWNER TO postgres;

--
-- TOC entry 243 (class 1259 OID 142545)
-- Name: additional_service_fees; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.additional_service_fees (
    id uuid NOT NULL,
    listing_id uuid,
    service_name character varying,
    description text,
    service_price double precision
);


ALTER TABLE listing.additional_service_fees OWNER TO postgres;

--
-- TOC entry 266 (class 1259 OID 142826)
-- Name: aqua_tourism_tour_dates; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.aqua_tourism_tour_dates (
    id uuid NOT NULL,
    listing_id uuid,
    start_date date,
    start_time time without time zone,
    end_date date,
    end_time time without time zone
);


ALTER TABLE listing.aqua_tourism_tour_dates OWNER TO postgres;

--
-- TOC entry 265 (class 1259 OID 142813)
-- Name: aqua_tourism_tour_package; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.aqua_tourism_tour_package (
    id uuid NOT NULL,
    listing_id uuid,
    tour_package_name character varying,
    description character varying,
    price character varying,
    quantity_available character varying,
    minimum_quantity character varying
);


ALTER TABLE listing.aqua_tourism_tour_package OWNER TO postgres;

--
-- TOC entry 275 (class 1259 OID 142929)
-- Name: available_dates; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.available_dates (
    id uuid NOT NULL,
    listing_id uuid,
    date date,
    available boolean,
    start_time time without time zone,
    end_date date
);


ALTER TABLE listing.available_dates OWNER TO postgres;

--
-- TOC entry 241 (class 1259 OID 142519)
-- Name: business_documents; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.business_documents (
    id uuid NOT NULL,
    listing_id uuid,
    tour_guide_license_number character varying,
    tour_registration_number character varying,
    about_business character varying,
    registered_for_travel_for_life boolean,
    registered_for_green_leaf_rating boolean,
    award_in_tourism_sector text,
    udyog_aadhar_card_document_url character varying,
    aadhar_card_document_url character varying,
    pan_card_document_url character varying,
    cancelled_cheque_document_url character varying,
    document_name_one character varying,
    document_name_one_url character varying,
    document_name_two character varying,
    document_name_two_url character varying
);


ALTER TABLE listing.business_documents OWNER TO postgres;

--
-- TOC entry 236 (class 1259 OID 142449)
-- Name: categories; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.categories (
    id uuid NOT NULL,
    name character varying NOT NULL
);


ALTER TABLE listing.categories OWNER TO postgres;

--
-- TOC entry 267 (class 1259 OID 142837)
-- Name: company_packages; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.company_packages (
    id uuid NOT NULL,
    listing_id uuid,
    tour_package_name character varying,
    description character varying,
    price character varying,
    quantity_available character varying,
    minimum_quantity character varying,
    destination_from character varying,
    destination_to character varying
);


ALTER TABLE listing.company_packages OWNER TO postgres;

--
-- TOC entry 245 (class 1259 OID 142571)
-- Name: contact_details; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.contact_details (
    id uuid NOT NULL,
    listing_id uuid,
    business_address character varying,
    village_name character varying,
    city_name character varying,
    taluka_name character varying,
    district_name character varying,
    pin_code character varying,
    state_name character varying,
    country_name character varying,
    working_address character varying,
    latitude character varying,
    longitude character varying,
    email_address character varying,
    mobile_number character varying,
    landline_number character varying,
    country_code character varying,
    alternate_email_address character varying,
    alternate_mobile_number character varying
);


ALTER TABLE listing.contact_details OWNER TO postgres;

--
-- TOC entry 244 (class 1259 OID 142558)
-- Name: coupons; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.coupons (
    id uuid NOT NULL,
    listing_id uuid,
    coupon_code character varying,
    discount_type character varying,
    discount_amount real,
    coupon_quantity integer,
    coupon_expiry_date date,
    description text
);


ALTER TABLE listing.coupons OWNER TO postgres;

--
-- TOC entry 260 (class 1259 OID 142753)
-- Name: cuisine_menu; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.cuisine_menu (
    id uuid NOT NULL,
    listing_id uuid,
    menu_name character varying,
    menu_price real,
    menu_link_url character varying,
    menu_types character varying,
    menu_description text
);


ALTER TABLE listing.cuisine_menu OWNER TO postgres;

--
-- TOC entry 262 (class 1259 OID 142774)
-- Name: cuisine_menu_cuisine_menu_photos; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.cuisine_menu_cuisine_menu_photos (
    cuisine_menu_id uuid,
    cuisine_menu_photos_id uuid
);


ALTER TABLE listing.cuisine_menu_cuisine_menu_photos OWNER TO postgres;

--
-- TOC entry 261 (class 1259 OID 142766)
-- Name: cuisine_menu_photos; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.cuisine_menu_photos (
    id uuid NOT NULL,
    photo_url character varying
);


ALTER TABLE listing.cuisine_menu_photos OWNER TO postgres;

--
-- TOC entry 258 (class 1259 OID 142729)
-- Name: event_experiences_tickets; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.event_experiences_tickets (
    id uuid NOT NULL,
    listing_id uuid,
    ticket_name character varying,
    ticket_price real,
    ticket_quantity_available integer,
    minimum_quantity integer,
    description text
);


ALTER TABLE listing.event_experiences_tickets OWNER TO postgres;

--
-- TOC entry 259 (class 1259 OID 142742)
-- Name: event_experiences_timeslots; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.event_experiences_timeslots (
    id uuid NOT NULL,
    fromtime time without time zone,
    totime time without time zone,
    listing_id uuid,
    available_slots integer
);


ALTER TABLE listing.event_experiences_timeslots OWNER TO postgres;

--
-- TOC entry 271 (class 1259 OID 142887)
-- Name: events_festivals_performers; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.events_festivals_performers (
    id uuid NOT NULL,
    listing_id uuid,
    name character varying,
    job_or_position character varying,
    website_url character varying,
    description text,
    image_url character varying
);


ALTER TABLE listing.events_festivals_performers OWNER TO postgres;

--
-- TOC entry 272 (class 1259 OID 142900)
-- Name: events_festivals_performers_social_urls; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.events_festivals_performers_social_urls (
    id uuid NOT NULL,
    name character varying,
    social_url character varying
);


ALTER TABLE listing.events_festivals_performers_social_urls OWNER TO postgres;

--
-- TOC entry 273 (class 1259 OID 142908)
-- Name: events_festivals_performers_urls; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.events_festivals_performers_urls (
    events_festivals_performers uuid,
    events_festivals_performers_social_urls_id uuid
);


ALTER TABLE listing.events_festivals_performers_urls OWNER TO postgres;

--
-- TOC entry 270 (class 1259 OID 142874)
-- Name: events_festivals_pricing; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.events_festivals_pricing (
    id uuid NOT NULL,
    listing_id uuid,
    free boolean,
    third_party_registration_url character varying,
    listing_quantities integer,
    start_date date,
    start_time time without time zone,
    end_date date,
    end_time time without time zone
);


ALTER TABLE listing.events_festivals_pricing OWNER TO postgres;

--
-- TOC entry 269 (class 1259 OID 142863)
-- Name: experiences_activities_slots_pricing; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.experiences_activities_slots_pricing (
    id uuid NOT NULL,
    listing_id uuid,
    adult_price real,
    children_price real,
    foreigner_price real
);


ALTER TABLE listing.experiences_activities_slots_pricing OWNER TO postgres;

--
-- TOC entry 246 (class 1259 OID 142589)
-- Name: facilities; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.facilities (
    id uuid NOT NULL,
    facilitiy character varying
);


ALTER TABLE listing.facilities OWNER TO postgres;

--
-- TOC entry 240 (class 1259 OID 142506)
-- Name: faqs; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.faqs (
    id uuid NOT NULL,
    listing_id uuid,
    question text,
    answer character varying
);


ALTER TABLE listing.faqs OWNER TO postgres;

--
-- TOC entry 268 (class 1259 OID 142850)
-- Name: guided_tours_tour_packages; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.guided_tours_tour_packages (
    id uuid NOT NULL,
    listing_id uuid,
    tour_package_name character varying,
    description character varying,
    price character varying,
    quantity_available character varying,
    minimum_quantity character varying
);


ALTER TABLE listing.guided_tours_tour_packages OWNER TO postgres;

--
-- TOC entry 263 (class 1259 OID 142787)
-- Name: handicrafts_souvenirs_documents; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.handicrafts_souvenirs_documents (
    id uuid NOT NULL,
    listing_id uuid,
    document_one_name character varying,
    document_one_url character varying,
    document_two_name character varying,
    document_two_url character varying,
    document_three_name character varying,
    document_three_url character varying,
    tour_guide_registration_number character varying,
    registered_for_travel_for_life boolean,
    registered_for_green_lead_rating boolean,
    received_award_in_tourism_sector boolean,
    award_name character varying
);


ALTER TABLE listing.handicrafts_souvenirs_documents OWNER TO postgres;

--
-- TOC entry 264 (class 1259 OID 142800)
-- Name: handicrafts_souvenirs_tour_packages; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.handicrafts_souvenirs_tour_packages (
    id uuid NOT NULL,
    listing_id uuid,
    tour_package_name character varying,
    description character varying,
    price numeric,
    quantity_available integer,
    minimum_quantity integer
);


ALTER TABLE listing.handicrafts_souvenirs_tour_packages OWNER TO postgres;

--
-- TOC entry 247 (class 1259 OID 142597)
-- Name: listing_facility; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.listing_facility (
    category_id uuid,
    facility_id uuid
);


ALTER TABLE listing.listing_facility OWNER TO postgres;

--
-- TOC entry 238 (class 1259 OID 142473)
-- Name: listings; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.listings (
    id uuid NOT NULL,
    user_id uuid,
    slug character varying,
    category_id uuid,
    name_of_business character varying,
    name_of_owner character varying,
    website_url character varying,
    aadhar_number character varying,
    gst_number character varying,
    fssai_number character varying,
    display_image_url character varying,
    header_slider character varying,
    description character varying,
    tour_policies text,
    agree_terms_conditions boolean NOT NULL,
    declare_information_correct boolean NOT NULL,
    financial_losses_risk_decleration boolean NOT NULL,
    save_listing_as_pending boolean,
    listing_category_id uuid,
    subcategory_other_name character varying,
    no_of_male_employees integer,
    no_of_female_employees integer,
    udyam_aadhar_registration_number character varying,
    max_guest_capacity integer,
    booking_note text,
    accommodation_sale_off real,
    approval_status character varying(20) DEFAULT 'pending'::character varying,
    platform_fee_status character varying(20) DEFAULT 'pending'::character varying,
    view_count integer DEFAULT 0 NOT NULL,
    admin_remark text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    is_archived boolean DEFAULT false,
    archived_at timestamp without time zone,
    registration_number bigint
);


ALTER TABLE listing.listings OWNER TO postgres;

--
-- TOC entry 239 (class 1259 OID 142496)
-- Name: listings_registration_number_seq; Type: SEQUENCE; Schema: listing; Owner: postgres
--

CREATE SEQUENCE listing.listings_registration_number_seq
    START WITH 10001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE listing.listings_registration_number_seq OWNER TO postgres;

--
-- TOC entry 5638 (class 0 OID 0)
-- Dependencies: 239
-- Name: listings_registration_number_seq; Type: SEQUENCE OWNED BY; Schema: listing; Owner: postgres
--

ALTER SEQUENCE listing.listings_registration_number_seq OWNED BY listing.listings.registration_number;


--
-- TOC entry 276 (class 1259 OID 142963)
-- Name: search_analytics; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.search_analytics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    keyword character varying(255) NOT NULL,
    category character varying(100),
    district character varying(100),
    search_count integer DEFAULT 1 NOT NULL,
    last_searched_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE listing.search_analytics OWNER TO postgres;

--
-- TOC entry 248 (class 1259 OID 142610)
-- Name: selected_facilities; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.selected_facilities (
    listing_id uuid NOT NULL,
    facility_id uuid NOT NULL
);


ALTER TABLE listing.selected_facilities OWNER TO postgres;

--
-- TOC entry 242 (class 1259 OID 142532)
-- Name: social_urls; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.social_urls (
    id uuid NOT NULL,
    listing_id uuid,
    name character varying,
    social_url character varying
);


ALTER TABLE listing.social_urls OWNER TO postgres;

--
-- TOC entry 274 (class 1259 OID 142921)
-- Name: social_websites; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.social_websites (
    id uuid NOT NULL,
    name character varying
);


ALTER TABLE listing.social_websites OWNER TO postgres;

--
-- TOC entry 237 (class 1259 OID 142460)
-- Name: sub_categories; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.sub_categories (
    id uuid NOT NULL,
    category_id uuid,
    subcategory character varying
);


ALTER TABLE listing.sub_categories OWNER TO postgres;

--
-- TOC entry 257 (class 1259 OID 142716)
-- Name: tour_packages; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.tour_packages (
    id uuid NOT NULL,
    listing_id uuid,
    tour_package_name character varying,
    description character varying,
    price character varying,
    no_of_people_per_batch character varying,
    minimum_quantity character varying
);


ALTER TABLE listing.tour_packages OWNER TO postgres;

--
-- TOC entry 249 (class 1259 OID 142626)
-- Name: working_hours; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.working_hours (
    id uuid NOT NULL,
    listing_id uuid,
    day_of_week character varying,
    open_all_day boolean,
    close_all_day boolean,
    open_specific_hours boolean
);


ALTER TABLE listing.working_hours OWNER TO postgres;

--
-- TOC entry 250 (class 1259 OID 142639)
-- Name: working_hours_specific; Type: TABLE; Schema: listing; Owner: postgres
--

CREATE TABLE listing.working_hours_specific (
    id uuid NOT NULL,
    working_hours_id uuid,
    from_time time without time zone,
    to_time time without time zone
);


ALTER TABLE listing.working_hours_specific OWNER TO postgres;

--
-- TOC entry 5230 (class 2604 OID 142497)
-- Name: listings registration_number; Type: DEFAULT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.listings ALTER COLUMN registration_number SET DEFAULT nextval('listing.listings_registration_number_seq'::regclass);


--
-- TOC entry 5626 (class 0 OID 143321)
-- Dependencies: 302
-- Data for Name: countries; Type: TABLE DATA; Schema: geography; Owner: postgres
--

COPY geography.countries (id, name, code, is_active, created_at) FROM stdin;
010d5b2c-cc69-4376-95f3-50af68ff43cf	India	IN	t	2026-02-23 20:41:29.48161
\.


--
-- TOC entry 5628 (class 0 OID 143345)
-- Dependencies: 304
-- Data for Name: districts; Type: TABLE DATA; Schema: geography; Owner: postgres
--

COPY geography.districts (id, state_id, name, division, is_active, created_at) FROM stdin;
5f2e49dd-9305-459f-b99e-6c16eff565e8	adf7a361-95a9-4775-ad3e-2885f8eb796d	Mumbai City	Konkan	t	2026-02-23 20:41:29.48161
0d7fd4bc-7ef1-4ac6-bc0a-8b4cbbda3dca	adf7a361-95a9-4775-ad3e-2885f8eb796d	Mumbai Suburban	Konkan	t	2026-02-23 20:41:29.48161
c23ce687-2b9e-4a46-bbbf-8517acad5616	adf7a361-95a9-4775-ad3e-2885f8eb796d	Thane	Konkan	t	2026-02-23 20:41:29.48161
f762d55b-27ea-49a5-957e-68c145ed037a	adf7a361-95a9-4775-ad3e-2885f8eb796d	Palghar	Konkan	t	2026-02-23 20:41:29.48161
aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	adf7a361-95a9-4775-ad3e-2885f8eb796d	Raigad	Konkan	t	2026-02-23 20:41:29.48161
f4a7bf2d-a423-4146-ab94-406b8b16041f	adf7a361-95a9-4775-ad3e-2885f8eb796d	Ratnagiri	Konkan	t	2026-02-23 20:41:29.48161
0b94b4b1-98b5-40d3-9c59-460b71d02e51	adf7a361-95a9-4775-ad3e-2885f8eb796d	Sindhudurg	Konkan	t	2026-02-23 20:41:29.48161
841f3e8f-5530-4833-b0d6-13343b54225a	adf7a361-95a9-4775-ad3e-2885f8eb796d	Pune	Pune	t	2026-02-23 20:41:29.48161
49e809b0-43c5-4e4a-893e-df918fa2b373	adf7a361-95a9-4775-ad3e-2885f8eb796d	Sangli	Pune	t	2026-02-23 20:41:29.48161
24486687-c298-49fc-a171-3691abef9372	adf7a361-95a9-4775-ad3e-2885f8eb796d	Satara	Pune	t	2026-02-23 20:41:29.48161
e5bea33c-4fff-4302-ac22-2c5a860ef67c	adf7a361-95a9-4775-ad3e-2885f8eb796d	Solapur	Pune	t	2026-02-23 20:41:29.48161
3786776d-19ab-47f1-906b-ec9fc4058540	adf7a361-95a9-4775-ad3e-2885f8eb796d	Kolhapur	Pune	t	2026-02-23 20:41:29.48161
5f56f8a3-839b-46b7-99f1-df2d1587fa67	adf7a361-95a9-4775-ad3e-2885f8eb796d	Nashik	Nashik	t	2026-02-23 20:41:29.48161
e5d5c36d-1e36-4096-b0f1-b30dafdfa899	adf7a361-95a9-4775-ad3e-2885f8eb796d	Jalgaon	Nashik	t	2026-02-23 20:41:29.48161
109d34b8-8842-4d5d-b75b-2c9a91f6c6ae	adf7a361-95a9-4775-ad3e-2885f8eb796d	Dhule	Nashik	t	2026-02-23 20:41:29.48161
9fca513a-8f8b-4bc5-a770-43da890fd13a	adf7a361-95a9-4775-ad3e-2885f8eb796d	Nandurbar	Nashik	t	2026-02-23 20:41:29.48161
3be06e10-5ce1-448e-ad71-585d312a8b94	adf7a361-95a9-4775-ad3e-2885f8eb796d	Ahmednagar	Nashik	t	2026-02-23 20:41:29.48161
47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	adf7a361-95a9-4775-ad3e-2885f8eb796d	Aurangabad	Aurangabad	t	2026-02-23 20:41:29.48161
68ec1c3a-6089-4008-bf77-71b2de148129	adf7a361-95a9-4775-ad3e-2885f8eb796d	Beed	Aurangabad	t	2026-02-23 20:41:29.48161
665bfbab-6c80-4d47-b64a-0f5486bb7fbd	adf7a361-95a9-4775-ad3e-2885f8eb796d	Jalna	Aurangabad	t	2026-02-23 20:41:29.48161
af848308-3b73-4bfb-a479-cf3676589c1b	adf7a361-95a9-4775-ad3e-2885f8eb796d	Osmanabad	Aurangabad	t	2026-02-23 20:41:29.48161
7d8d0653-ef23-4d60-8b32-61e6a251ad86	adf7a361-95a9-4775-ad3e-2885f8eb796d	Nanded	Aurangabad	t	2026-02-23 20:41:29.48161
5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	adf7a361-95a9-4775-ad3e-2885f8eb796d	Latur	Aurangabad	t	2026-02-23 20:41:29.48161
0a3a0fed-93c9-44c2-924c-17cb81d4013a	adf7a361-95a9-4775-ad3e-2885f8eb796d	Parbhani	Aurangabad	t	2026-02-23 20:41:29.48161
c2de48fa-35de-4c1c-8978-73154f1e1ae5	adf7a361-95a9-4775-ad3e-2885f8eb796d	Hingoli	Aurangabad	t	2026-02-23 20:41:29.48161
928e91d5-094a-4268-bc3a-190d30f80acf	adf7a361-95a9-4775-ad3e-2885f8eb796d	Amravati	Amravati	t	2026-02-23 20:41:29.48161
bfc22424-af9b-4676-8efd-b33ba8452af0	adf7a361-95a9-4775-ad3e-2885f8eb796d	Akola	Amravati	t	2026-02-23 20:41:29.48161
ef3dbcf4-7f75-4623-891e-99c7c6c1697d	adf7a361-95a9-4775-ad3e-2885f8eb796d	Buldhana	Amravati	t	2026-02-23 20:41:29.48161
b1fcc052-2e78-49cc-b5b2-b90355a025ed	adf7a361-95a9-4775-ad3e-2885f8eb796d	Yavatmal	Amravati	t	2026-02-23 20:41:29.48161
d516d066-39a6-47dd-bd88-b3eed9c3cab4	adf7a361-95a9-4775-ad3e-2885f8eb796d	Washim	Amravati	t	2026-02-23 20:41:29.48161
d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	adf7a361-95a9-4775-ad3e-2885f8eb796d	Nagpur	Nagpur	t	2026-02-23 20:41:29.48161
d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	adf7a361-95a9-4775-ad3e-2885f8eb796d	Chandrapur	Nagpur	t	2026-02-23 20:41:29.48161
e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	adf7a361-95a9-4775-ad3e-2885f8eb796d	Bhandara	Nagpur	t	2026-02-23 20:41:29.48161
5fb11c9f-190f-4ce5-bfb5-61d58f132e40	adf7a361-95a9-4775-ad3e-2885f8eb796d	Gondia	Nagpur	t	2026-02-23 20:41:29.48161
767f42bc-6c33-42ba-866b-e66bb2fdead5	adf7a361-95a9-4775-ad3e-2885f8eb796d	Wardha	Nagpur	t	2026-02-23 20:41:29.48161
3bef10d2-a24d-4536-ba4c-9f857c4ff090	adf7a361-95a9-4775-ad3e-2885f8eb796d	Gadchiroli	Nagpur	t	2026-02-23 20:41:29.48161
\.


--
-- TOC entry 5627 (class 0 OID 143331)
-- Dependencies: 303
-- Data for Name: states; Type: TABLE DATA; Schema: geography; Owner: postgres
--

COPY geography.states (id, country_id, name, is_active, created_at) FROM stdin;
adf7a361-95a9-4775-ad3e-2885f8eb796d	010d5b2c-cc69-4376-95f3-50af68ff43cf	Maharashtra	t	2026-02-23 20:41:29.48161
\.


--
-- TOC entry 5629 (class 0 OID 143359)
-- Dependencies: 305
-- Data for Name: talukas; Type: TABLE DATA; Schema: geography; Owner: postgres
--

COPY geography.talukas (id, district_id, name, is_active, created_at) FROM stdin;
92190b16-be05-4e5d-8996-4d8a4334f78f	3be06e10-5ce1-448e-ad71-585d312a8b94	Akole	t	2026-07-07 15:23:05.595243
ce8c56a9-33c8-4d4f-a2ba-57f15d7e6342	3be06e10-5ce1-448e-ad71-585d312a8b94	Jamkhed	t	2026-07-07 15:23:05.595243
39c2400d-5d1a-4c64-9e8d-c96ac6097855	3be06e10-5ce1-448e-ad71-585d312a8b94	Karjat	t	2026-07-07 15:23:05.595243
e61bfe8c-dd3a-46f1-9518-43e40fc8cf8a	3be06e10-5ce1-448e-ad71-585d312a8b94	Kopargaon	t	2026-07-07 15:23:05.595243
0314d8b2-f18f-4b4c-af1f-8f0ffb46453d	3be06e10-5ce1-448e-ad71-585d312a8b94	Nagar	t	2026-07-07 15:23:05.595243
e75a461e-eeb2-4bc1-8fe8-6127c4f85e32	3be06e10-5ce1-448e-ad71-585d312a8b94	Nevasa	t	2026-07-07 15:23:05.595243
bff6439c-5b9c-4a4d-9d51-c7b68a6d1577	3be06e10-5ce1-448e-ad71-585d312a8b94	Parner	t	2026-07-07 15:23:05.595243
76e8c577-c0ee-447e-893c-dd56dd9d6c62	3be06e10-5ce1-448e-ad71-585d312a8b94	Pathardi	t	2026-07-07 15:23:05.595243
6a708b6a-7db1-4875-a13a-0100229d6282	3be06e10-5ce1-448e-ad71-585d312a8b94	Rahata	t	2026-07-07 15:23:05.595243
6bcdae17-26a7-48d2-8c84-26af339f84c5	3be06e10-5ce1-448e-ad71-585d312a8b94	Rahuri	t	2026-07-07 15:23:05.595243
8ce20ee3-f96b-447a-a287-4d08abc8367c	3be06e10-5ce1-448e-ad71-585d312a8b94	Sangamner	t	2026-07-07 15:23:05.595243
066126b1-48b6-4a2d-803c-cf8e5d991dec	3be06e10-5ce1-448e-ad71-585d312a8b94	Shevgaon	t	2026-07-07 15:23:05.595243
389e9b7d-12bd-4b7b-98cc-7d4a9a9a407e	3be06e10-5ce1-448e-ad71-585d312a8b94	Shrigonda	t	2026-07-07 15:23:05.595243
50d4d51d-2276-46c9-ae89-98fb1e4ce317	3be06e10-5ce1-448e-ad71-585d312a8b94	Shrirampur	t	2026-07-07 15:23:05.595243
e3d09c3d-bab6-47fd-8be0-17203ab89ad8	bfc22424-af9b-4676-8efd-b33ba8452af0	Akola	t	2026-07-07 15:23:05.595243
4f9e9294-1544-4906-9e35-ef36de7e7df1	bfc22424-af9b-4676-8efd-b33ba8452af0	Akot	t	2026-07-07 15:23:05.595243
3a101edb-3689-4227-a952-ae5ba0535ffb	bfc22424-af9b-4676-8efd-b33ba8452af0	Balapur	t	2026-07-07 15:23:05.595243
e5818db7-ba31-4796-82da-9e350bdc4824	bfc22424-af9b-4676-8efd-b33ba8452af0	Barshitakli	t	2026-07-07 15:23:05.595243
85ef4944-0bf7-48a2-affd-afca05cfeb8b	bfc22424-af9b-4676-8efd-b33ba8452af0	Murtajapur	t	2026-07-07 15:23:05.595243
7a29bc41-e571-4d06-9bf7-9ca60206087d	bfc22424-af9b-4676-8efd-b33ba8452af0	Patur	t	2026-07-07 15:23:05.595243
92bdbd20-5842-41f1-b46d-4a3a059c705e	bfc22424-af9b-4676-8efd-b33ba8452af0	Telhara	t	2026-07-07 15:23:05.595243
b1079488-0df2-44a9-ac8b-7663d7e3f050	928e91d5-094a-4268-bc3a-190d30f80acf	Achalpur	t	2026-07-07 15:23:05.595243
b04914fb-44b7-45b6-b882-a8239614ef74	928e91d5-094a-4268-bc3a-190d30f80acf	Amravati	t	2026-07-07 15:23:05.595243
3e8976c9-5f32-41e8-8614-5aedcebecd59	928e91d5-094a-4268-bc3a-190d30f80acf	Anjangaon-Surji	t	2026-07-07 15:23:05.595243
60a3b987-5cd2-4292-b1bb-a85a18fb7552	928e91d5-094a-4268-bc3a-190d30f80acf	Bhatkuli	t	2026-07-07 15:23:05.595243
a303ec4c-1d3e-4cf3-a359-bf9bbb708340	928e91d5-094a-4268-bc3a-190d30f80acf	Chandur	t	2026-07-07 15:23:05.595243
9e6ec9ca-6abb-4f9c-ba2d-8f7b9602608c	928e91d5-094a-4268-bc3a-190d30f80acf	Chandurbazar	t	2026-07-07 15:23:05.595243
68ebc7f4-dc37-45a7-b547-ca2a1af38df4	928e91d5-094a-4268-bc3a-190d30f80acf	Chikhaldara	t	2026-07-07 15:23:05.595243
672ea4c5-5de4-4930-8353-a5731f0c218f	928e91d5-094a-4268-bc3a-190d30f80acf	Daryapur	t	2026-07-07 15:23:05.595243
4fab6766-e216-4468-8278-b5e92c2d779d	928e91d5-094a-4268-bc3a-190d30f80acf	Dhamangaon	t	2026-07-07 15:23:05.595243
a24f4da8-9a90-4f34-9de5-5cfa522427c6	928e91d5-094a-4268-bc3a-190d30f80acf	Dharni	t	2026-07-07 15:23:05.595243
74eb11c1-2ff6-43af-8112-e0c3f0466fcf	928e91d5-094a-4268-bc3a-190d30f80acf	Morshi	t	2026-07-07 15:23:05.595243
f3baafcc-9a8a-4afa-918d-a814082e24d6	928e91d5-094a-4268-bc3a-190d30f80acf	Nandgaon Khandeshwar	t	2026-07-07 15:23:05.595243
76390ed0-5fda-4428-919f-4b223b1bf671	928e91d5-094a-4268-bc3a-190d30f80acf	Tiosa	t	2026-07-07 15:23:05.595243
c7bd1672-c436-42cc-8766-160c2c394126	928e91d5-094a-4268-bc3a-190d30f80acf	Warud	t	2026-07-07 15:23:05.595243
d46db3d9-07d5-4d75-a83f-202a93347220	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Aurangabad	t	2026-07-07 15:23:05.595243
b6d8ae57-2611-4282-9466-621c3f5c093f	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Gangapur	t	2026-07-07 15:23:05.595243
9b9d9d9d-68d7-4fe5-b11b-d36799874f5c	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Kannad	t	2026-07-07 15:23:05.595243
cba45b13-3e74-4308-ad10-cfdcc8eeffda	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Khuldabad	t	2026-07-07 15:23:05.595243
e5e36823-2f24-4ab6-9b21-f37b252299f1	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Paithan	t	2026-07-07 15:23:05.595243
f7e84740-9b22-4952-b740-37c50931794b	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Phulambri	t	2026-07-07 15:23:05.595243
2e3f0503-aebb-4ec3-90eb-31473fa32847	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Sillod	t	2026-07-07 15:23:05.595243
4b3f968a-3557-46af-b02b-eeaa81799711	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Soegaon	t	2026-07-07 15:23:05.595243
5b059206-cf15-4375-b24c-3906e202c9aa	47cdfae9-1ec6-4c81-aa82-8fc8bd97d07d	Vaijapur	t	2026-07-07 15:23:05.595243
55732f0d-0187-4404-90b7-6d76f3c24048	68ec1c3a-6089-4008-bf77-71b2de148129	Ambajogai	t	2026-07-07 15:23:05.595243
b1c36f30-dc7f-4f14-8794-bf8659ab82eb	68ec1c3a-6089-4008-bf77-71b2de148129	Ashti	t	2026-07-07 15:23:05.595243
3ae66aae-0552-4ec5-9ce9-80ac258b3579	68ec1c3a-6089-4008-bf77-71b2de148129	Beed	t	2026-07-07 15:23:05.595243
eca0cce2-0bfb-40ef-bd77-3cf8a5c3fb9e	68ec1c3a-6089-4008-bf77-71b2de148129	Dharur	t	2026-07-07 15:23:05.595243
11dc18ae-5f01-4697-887b-dda47d9bddca	68ec1c3a-6089-4008-bf77-71b2de148129	Georai	t	2026-07-07 15:23:05.595243
b53ea786-f570-4d0c-a049-776e462b37c9	68ec1c3a-6089-4008-bf77-71b2de148129	Kaij	t	2026-07-07 15:23:05.595243
bbe1ac18-59d4-431c-8a4a-f88c15779a7a	68ec1c3a-6089-4008-bf77-71b2de148129	Majalgaon	t	2026-07-07 15:23:05.595243
9863769b-f7bc-49fd-9bce-19d0b6779116	68ec1c3a-6089-4008-bf77-71b2de148129	Parli	t	2026-07-07 15:23:05.595243
e8d96eec-67e4-4154-8b14-10fe3bded49f	68ec1c3a-6089-4008-bf77-71b2de148129	Patoda	t	2026-07-07 15:23:05.595243
e27ac2fb-49ef-4286-8553-a41a438e300f	68ec1c3a-6089-4008-bf77-71b2de148129	Shirur-Kasar	t	2026-07-07 15:23:05.595243
87555d01-19ad-4f90-8b2e-c1e3d5f35beb	68ec1c3a-6089-4008-bf77-71b2de148129	Wadwani	t	2026-07-07 15:23:05.595243
5f01c9e8-f198-443a-91b0-a2e4ac2bca55	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Bhandara	t	2026-07-07 15:23:05.595243
16453779-7d22-4e33-9cc7-b56f4f31c635	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Lakhandur	t	2026-07-07 15:23:05.595243
4555bb7a-928a-4418-8703-6d6d6f8b6592	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Lakhani	t	2026-07-07 15:23:05.595243
f4f550ca-a6bb-4e4f-8b51-dff9344e3e16	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Mohadi	t	2026-07-07 15:23:05.595243
65d158d9-7465-4fe6-8f40-d9e0253dd8ec	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Pauni	t	2026-07-07 15:23:05.595243
8e26b342-1bd4-4a1c-b8da-53c7050d3764	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Sakoli	t	2026-07-07 15:23:05.595243
9207243e-7e74-43d6-9477-afd7ee47eb18	e9b8ad76-70bb-4844-ad51-7f7915b6f8ef	Tumsar	t	2026-07-07 15:23:05.595243
e0d3edc7-e7b8-43bd-abfa-2273dceb461c	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Buldhana	t	2026-07-07 15:23:05.595243
262adad9-166f-41a2-94e6-281a72608741	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Chikhli	t	2026-07-07 15:23:05.595243
04f8aa48-d12a-4b8e-b0cd-90f78a4d2fff	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Deulgaon Raja	t	2026-07-07 15:23:05.595243
9dc10044-70aa-479b-96b1-27330bf0c058	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Jalgaon Jamod	t	2026-07-07 15:23:05.595243
b5418b1e-a0f2-4688-8aec-c274bc7c56a4	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Khamgaon	t	2026-07-07 15:23:05.595243
d1f861fe-14ae-4e35-98cb-3ec733b49ff4	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Lonar	t	2026-07-07 15:23:05.595243
3dfbcc2c-bdba-427f-9e52-37fb9bd1f710	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Malkapur	t	2026-07-07 15:23:05.595243
b1bb3c18-412b-4975-9e61-c1fd25922c43	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Mehkar	t	2026-07-07 15:23:05.595243
746944ec-25cc-4217-8d09-7d00b8cb6503	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Motala	t	2026-07-07 15:23:05.595243
be58bf00-3d8a-44d4-b683-7dad3aa67975	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Nandura	t	2026-07-07 15:23:05.595243
8b372e84-52ae-43d5-b819-a0e10981f572	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Sangrampur	t	2026-07-07 15:23:05.595243
c0d2f766-b5a6-4bd9-882a-fd59abe8b20d	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Shegaon	t	2026-07-07 15:23:05.595243
21aca7d8-67fb-4731-9cca-45a827c89539	ef3dbcf4-7f75-4623-891e-99c7c6c1697d	Sindkhed Raja	t	2026-07-07 15:23:05.595243
1717fafa-91c7-4a3a-bda8-23d72fbd56c9	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Ballarpur	t	2026-07-07 15:23:05.595243
bf6aa280-b964-4201-a96c-cd6528d3f8de	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Bhadravati	t	2026-07-07 15:23:05.595243
6fe74482-f96e-48a0-a045-0af3a6fd38bf	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Bramhapuri	t	2026-07-07 15:23:05.595243
8590aabe-c328-4068-8e18-69b2650c05b8	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Chandrapur	t	2026-07-07 15:23:05.595243
54afedfb-f4ed-42e8-bd48-2369b815f8d8	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Chimur	t	2026-07-07 15:23:05.595243
27b21799-a003-4ef0-a0a6-c57a58be79d8	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Gondpimpri	t	2026-07-07 15:23:05.595243
5cf8c124-d518-42f3-a7f8-d0b271f72e42	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Jiwati	t	2026-07-07 15:23:05.595243
7e8c6b76-6e09-4b83-9468-0fbe56070421	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Korpana	t	2026-07-07 15:23:05.595243
2bd2ef57-c0a5-478c-b7ef-66848bdda6d7	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Mul	t	2026-07-07 15:23:05.595243
8ce692ca-ba53-437c-9961-3a47b74ff9c1	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Nagbhid	t	2026-07-07 15:23:05.595243
57b183c7-5616-43b0-b9d2-fb4394d948b0	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Pombhurna	t	2026-07-07 15:23:05.595243
4246eebf-792f-4ea2-81a2-5ede5a9ea6eb	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Rajura	t	2026-07-07 15:23:05.595243
3cfddc6d-a97e-47ef-b88c-4606ce99452f	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Saoli	t	2026-07-07 15:23:05.595243
8dd57b0d-6964-43d3-95fd-7d583e019e1b	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Sindewahi	t	2026-07-07 15:23:05.595243
a2266f32-1401-40bf-b7d9-eff16b314691	d6518d1a-9b7f-491b-b8c3-92f93d65d5e7	Warora	t	2026-07-07 15:23:05.595243
1a14e19c-2085-4a50-8d83-3476ae105346	109d34b8-8842-4d5d-b75b-2c9a91f6c6ae	Dhule	t	2026-07-07 15:23:05.595243
56d93160-9ea5-43a2-8e68-2ca5bed91798	109d34b8-8842-4d5d-b75b-2c9a91f6c6ae	Sakri	t	2026-07-07 15:23:05.595243
878472c6-d1f0-49b4-b474-475e565e5181	109d34b8-8842-4d5d-b75b-2c9a91f6c6ae	Shirpur	t	2026-07-07 15:23:05.595243
680e76b3-6e86-4d14-9297-2a230b0442a8	109d34b8-8842-4d5d-b75b-2c9a91f6c6ae	Sindkheda	t	2026-07-07 15:23:05.595243
a1e1e8f3-1f2f-483a-9637-b2f0633aab40	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Aheri	t	2026-07-07 15:23:05.595243
f9e683e3-15fe-454f-81fc-8e953be23403	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Armori	t	2026-07-07 15:23:05.595243
98e5cad2-9351-4247-b802-1914defe2999	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Bhamragad	t	2026-07-07 15:23:05.595243
23d9c708-8ec7-41f4-ab52-7712f91f8558	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Chamorshi	t	2026-07-07 15:23:05.595243
6f0cab9b-8fd1-4b04-b0bf-ee7bb03355f2	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Desaiganj	t	2026-07-07 15:23:05.595243
35a0983f-237a-4c2b-a1b9-fb973d600c37	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Dhanora	t	2026-07-07 15:23:05.595243
a255fd64-71c8-4974-81ed-0f4dfedce9e1	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Etapalli	t	2026-07-07 15:23:05.595243
f7cbfc79-5761-44e6-8e64-bbf7d3961c47	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Gadchiroli	t	2026-07-07 15:23:05.595243
3b8c8554-5125-40b2-85d4-f9b1045ed018	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Korchi	t	2026-07-07 15:23:05.595243
617a30d9-a7c2-48b8-add8-f5ba5ba302bd	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Kurkheda	t	2026-07-07 15:23:05.595243
103814c8-fa7d-469a-b5df-0868a5180aa2	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Mulchera	t	2026-07-07 15:23:05.595243
730a595c-a841-4d9c-a9c7-028ec20b85fb	3bef10d2-a24d-4536-ba4c-9f857c4ff090	Sironcha	t	2026-07-07 15:23:05.595243
51ddf25e-3965-4eee-bbf0-b49ec8fcc8a5	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Amgaon	t	2026-07-07 15:23:05.595243
f6b3a00e-37b3-4222-afee-0a48cc53c5f5	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Arjuni-Morgaon	t	2026-07-07 15:23:05.595243
8fc663ca-4135-4fe6-aca9-a19af193efc9	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Deori	t	2026-07-07 15:23:05.595243
24d2c364-4332-444c-a523-084da6dcf20f	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Gondia	t	2026-07-07 15:23:05.595243
2fc91d14-bf54-4805-a35b-349ecc724a74	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Goregaon	t	2026-07-07 15:23:05.595243
654fa831-2791-4982-9cdb-c896b3cb793a	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Sadak-Arjuni	t	2026-07-07 15:23:05.595243
5d55cf3e-83bd-4026-bde9-8ea2d41d76da	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Salekasa	t	2026-07-07 15:23:05.595243
351db23e-2dfa-4791-b51a-dd86859d6daf	5fb11c9f-190f-4ce5-bfb5-61d58f132e40	Tiroda	t	2026-07-07 15:23:05.595243
c958ccbb-327b-4894-8509-d6b53f250f76	c2de48fa-35de-4c1c-8978-73154f1e1ae5	Aundha Nagnath	t	2026-07-07 15:23:05.595243
83308ea5-7a0d-4e1b-95df-95bd1e7d2ff1	c2de48fa-35de-4c1c-8978-73154f1e1ae5	Basmath	t	2026-07-07 15:23:05.595243
5389bee0-ba1c-4afb-a19b-2bce7ba2638a	c2de48fa-35de-4c1c-8978-73154f1e1ae5	Hingoli	t	2026-07-07 15:23:05.595243
55397e2e-08f9-413c-9b6b-14be6b97b88e	c2de48fa-35de-4c1c-8978-73154f1e1ae5	Kalamnuri	t	2026-07-07 15:23:05.595243
57aeaec8-dbbb-4772-80af-165f616472dc	c2de48fa-35de-4c1c-8978-73154f1e1ae5	Sengaon	t	2026-07-07 15:23:05.595243
e40dc496-52bc-459a-807b-ecc2ce58575a	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Amalner	t	2026-07-07 15:23:05.595243
ec711cc9-8ab6-4f36-8c2b-31280118480c	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Bhadgaon	t	2026-07-07 15:23:05.595243
834b908c-f21d-49f9-83cf-ebd2949d3c0e	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Bhusawal	t	2026-07-07 15:23:05.595243
83f0341e-0545-4b53-b171-117e81404fa7	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Bodwad	t	2026-07-07 15:23:05.595243
884f5cd6-ae75-4285-8b30-0d5fe813013b	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Chalisgaon	t	2026-07-07 15:23:05.595243
8ceaa548-4baa-4609-973f-06a3d208c4b5	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Chopda	t	2026-07-07 15:23:05.595243
cf2a2b54-c987-4150-ac9e-baf1ed7821aa	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Dharangaon	t	2026-07-07 15:23:05.595243
3ff19649-808d-4869-a1b4-da495a101994	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Erandol	t	2026-07-07 15:23:05.595243
bd6ece1a-060c-414d-966a-25839d493e8f	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Jalgaon	t	2026-07-07 15:23:05.595243
6ad04cb7-ff20-460f-ad2e-4a9ea442ab53	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Jamner	t	2026-07-07 15:23:05.595243
fc5022c2-b968-4395-a5e9-95789b603347	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Muktainagar	t	2026-07-07 15:23:05.595243
98a1993b-5b3e-4cac-863e-59f94b24d435	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Pachora	t	2026-07-07 15:23:05.595243
93e773e9-b654-44a6-8b00-f71227bb1e50	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Parola	t	2026-07-07 15:23:05.595243
8aaed7ed-feec-424c-83c7-9a9090000a34	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Raver	t	2026-07-07 15:23:05.595243
fb178d9b-2b71-4973-84b6-cfc2eb1abd98	e5d5c36d-1e36-4096-b0f1-b30dafdfa899	Yawal	t	2026-07-07 15:23:05.595243
0f193dde-2258-4f50-9823-9d9a3e41db58	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Ambad	t	2026-07-07 15:23:05.595243
e2f453e7-eca6-4faf-8d29-5dfd2a8cf016	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Badnapur	t	2026-07-07 15:23:05.595243
6d895668-3b8f-48d8-835f-e379c4c3e7ea	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Bhokardan	t	2026-07-07 15:23:05.595243
d990b4cf-23a1-4f1a-bebd-ca59d94747cc	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Ghansawangi	t	2026-07-07 15:23:05.595243
eacdb46a-a569-45ad-a070-39a175ac5141	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Jafrabad	t	2026-07-07 15:23:05.595243
d3f4dc08-b61d-4480-bef8-9dc73b414fa0	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Jalna	t	2026-07-07 15:23:05.595243
205b8f4d-131a-480a-b26c-3f2cc46a40e7	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Mantha	t	2026-07-07 15:23:05.595243
7507aeb1-38fd-46fa-bed7-3dc4135159e8	665bfbab-6c80-4d47-b64a-0f5486bb7fbd	Partur	t	2026-07-07 15:23:05.595243
3b0847e3-3dc8-4e7a-93ef-bbeac263be59	3786776d-19ab-47f1-906b-ec9fc4058540	Ajra	t	2026-07-07 15:23:05.595243
2846e397-3515-45cf-83e1-779dc42ab1db	3786776d-19ab-47f1-906b-ec9fc4058540	Bhudargad	t	2026-07-07 15:23:05.595243
be71983e-adbf-4016-bd9a-eb901faf1d76	3786776d-19ab-47f1-906b-ec9fc4058540	Chandgad	t	2026-07-07 15:23:05.595243
0964307a-b5f4-41f2-a5fa-c8fe5b49f480	3786776d-19ab-47f1-906b-ec9fc4058540	Gadhinglaj	t	2026-07-07 15:23:05.595243
c7446a83-650e-4bdb-bd92-7cd39f0e5320	3786776d-19ab-47f1-906b-ec9fc4058540	Gaganbawada	t	2026-07-07 15:23:05.595243
d425800a-26fc-4133-9c4d-c206d2ad3f6a	3786776d-19ab-47f1-906b-ec9fc4058540	Hatkanangale	t	2026-07-07 15:23:05.595243
60fc82b5-390e-4358-a0b4-987351efe52a	3786776d-19ab-47f1-906b-ec9fc4058540	Kagal	t	2026-07-07 15:23:05.595243
5d3bb20c-db08-4e42-8f78-f0d85e5b0f45	3786776d-19ab-47f1-906b-ec9fc4058540	Karvir	t	2026-07-07 15:23:05.595243
9ded31b8-b0ee-4003-8827-184d1a39329c	3786776d-19ab-47f1-906b-ec9fc4058540	Panhala	t	2026-07-07 15:23:05.595243
a4038a81-b4c9-4c64-842f-31eadffd3915	3786776d-19ab-47f1-906b-ec9fc4058540	Radhanagari	t	2026-07-07 15:23:05.595243
dd132539-604a-4e53-9821-f2b2a20002e5	3786776d-19ab-47f1-906b-ec9fc4058540	Shahuwadi	t	2026-07-07 15:23:05.595243
655c673e-e630-48eb-a23f-4415321ffa71	3786776d-19ab-47f1-906b-ec9fc4058540	Shirol	t	2026-07-07 15:23:05.595243
2216250b-e2be-44bf-90f5-dc315567b5a4	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Ahmedpur	t	2026-07-07 15:23:05.595243
05b1c3d4-ee48-4e64-849a-575483c12f7e	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Ausa	t	2026-07-07 15:23:05.595243
62c4373d-d3df-4e8a-ba1d-1d128865ea75	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Chakur	t	2026-07-07 15:23:05.595243
f0a0faf5-d5f3-442a-97b3-048e389cb6e6	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Deoni	t	2026-07-07 15:23:05.595243
3e48d2f1-14fe-4333-8234-357cfc4e7a57	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Jalkot	t	2026-07-07 15:23:05.595243
1e95d65e-ae77-4e11-961a-f64858868f89	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Latur	t	2026-07-07 15:23:05.595243
978336ac-846c-4f57-adbd-322293cd0c78	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Nilanga	t	2026-07-07 15:23:05.595243
2451d695-1513-4540-97e6-2dd0a8bb9e1f	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Renapur	t	2026-07-07 15:23:05.595243
56b51e6e-f8b4-4290-a779-bf5371092817	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Shirur Anantpal	t	2026-07-07 15:23:05.595243
1d2a3a6f-d026-461a-809d-8cdac1c8f352	5da6c3ea-a65d-41f9-b9a8-637b3f26f31b	Udgir	t	2026-07-07 15:23:05.595243
0a587fc7-24fb-4be3-9090-ba046f3cdd5a	5f2e49dd-9305-459f-b99e-6c16eff565e8	Mumbai City	t	2026-07-07 15:23:05.595243
2dabb40a-b78b-4e86-b389-295658b89caf	0d7fd4bc-7ef1-4ac6-bc0a-8b4cbbda3dca	Andheri	t	2026-07-07 15:23:05.595243
3c54d951-a374-4b37-a68a-e1d500d62fc0	0d7fd4bc-7ef1-4ac6-bc0a-8b4cbbda3dca	Borivali	t	2026-07-07 15:23:05.595243
51fa70db-c64a-45ff-9961-ab0f6898be37	0d7fd4bc-7ef1-4ac6-bc0a-8b4cbbda3dca	Kurla	t	2026-07-07 15:23:05.595243
fc4d1e73-792d-46c1-b78f-bdbf57fca042	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Bhiwapur	t	2026-07-07 15:23:05.595243
3dce6953-5207-4004-8f54-207f042801e1	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Hingna	t	2026-07-07 15:23:05.595243
15c6a147-7d2e-4b16-88ad-47974f03e560	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Kalameshwar	t	2026-07-07 15:23:05.595243
57a9765c-b6ed-45b3-ad04-867aecc02d69	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Kamptee	t	2026-07-07 15:23:05.595243
b74085e5-abc6-4e4b-b2a0-726687cf1ac1	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Katol	t	2026-07-07 15:23:05.595243
83f17c2c-e54a-43b1-b019-913e8693943a	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Kuhi	t	2026-07-07 15:23:05.595243
53e3e4d3-8a7b-47ed-b752-2ebfbb83b125	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Mouda	t	2026-07-07 15:23:05.595243
4ed432fa-3435-4605-858c-d5f95b5cb94e	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Nagpur Rural	t	2026-07-07 15:23:05.595243
e24d36ff-b22d-4c0c-b513-3436baac8df9	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Nagpur Urban	t	2026-07-07 15:23:05.595243
52ff3696-6e36-44e6-a443-a3ae0f6c41fe	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Narkhed	t	2026-07-07 15:23:05.595243
e5e3e084-c40b-4fbb-9d9e-37014f687647	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Parseoni	t	2026-07-07 15:23:05.595243
d4b5f74f-aa20-4d4a-a2a6-cbccb1422431	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Ramtek	t	2026-07-07 15:23:05.595243
64ab6c63-03dd-423c-bd2f-b5c0d5558eb1	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Savner	t	2026-07-07 15:23:05.595243
e930ea23-c603-4420-a18b-3ddf4d1c7fa0	d4cbf6cf-82ac-4dad-bfef-11f0bfcd9c7f	Umred	t	2026-07-07 15:23:05.595243
2e50735c-1c52-4752-8344-7b6e97064f77	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Ardhapur	t	2026-07-07 15:23:05.595243
8a53aa77-8b18-41c4-aa8c-23569882c496	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Bhokar	t	2026-07-07 15:23:05.595243
718a842b-0877-484c-8e37-e185b27f5d3b	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Biloli	t	2026-07-07 15:23:05.595243
9e6c6ad0-ed9a-4cee-8334-c5491fb0e116	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Deglur	t	2026-07-07 15:23:05.595243
8ed2b4cf-2331-40c2-b2ab-37157bcf509e	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Dharmabad	t	2026-07-07 15:23:05.595243
694203fd-1bcb-4ad7-8d80-401bfec2d82f	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Hadgaon	t	2026-07-07 15:23:05.595243
1fe79890-3c0a-4a6c-b25c-ba1cfb93b105	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Himayatnagar	t	2026-07-07 15:23:05.595243
32660c33-ff65-4a8f-a577-68b33d13deb7	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Kandhar	t	2026-07-07 15:23:05.595243
ceb46379-f8cd-46a1-ba67-eb916cc42d4f	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Kinwat	t	2026-07-07 15:23:05.595243
67344850-4644-4e88-b54f-a5970be029a1	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Loha	t	2026-07-07 15:23:05.595243
9c13d5f0-1ade-4f03-ab99-c1d1738d307c	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Mahur	t	2026-07-07 15:23:05.595243
ddac273f-e7b1-493b-99b6-df832b467a50	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Mudkhed	t	2026-07-07 15:23:05.595243
743dd489-5749-422a-94ac-2f9d126e4002	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Mukhed	t	2026-07-07 15:23:05.595243
db2acb27-dac6-45ea-b22c-f616b1ee35ce	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Naigaon	t	2026-07-07 15:23:05.595243
ea88f23b-2bbf-4c9b-892a-59f02534d2a2	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Nanded	t	2026-07-07 15:23:05.595243
aff7dc30-496a-4576-afaf-33d55d90d06c	7d8d0653-ef23-4d60-8b32-61e6a251ad86	Umri	t	2026-07-07 15:23:05.595243
eadbc6d7-f17d-43ff-97a4-ed4f68ec1b47	9fca513a-8f8b-4bc5-a770-43da890fd13a	Akkalkuwa	t	2026-07-07 15:23:05.595243
f34d9f48-7944-4f84-a389-8956f9fc70fc	9fca513a-8f8b-4bc5-a770-43da890fd13a	Dhadgaon	t	2026-07-07 15:23:05.595243
0e69a71c-c88c-455e-8d47-b71e67dad553	9fca513a-8f8b-4bc5-a770-43da890fd13a	Nandurbar	t	2026-07-07 15:23:05.595243
b2a15777-6d60-453d-a54a-dd3320782773	9fca513a-8f8b-4bc5-a770-43da890fd13a	Navapur	t	2026-07-07 15:23:05.595243
1b6d1ea1-017f-49d6-b110-a00faa58aff6	9fca513a-8f8b-4bc5-a770-43da890fd13a	Shahada	t	2026-07-07 15:23:05.595243
e21d8eba-ff90-4184-9b35-98e2b4eea5c5	9fca513a-8f8b-4bc5-a770-43da890fd13a	Talode	t	2026-07-07 15:23:05.595243
63cddbac-7589-48f9-aa69-f8eefcd499f3	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Baglan	t	2026-07-07 15:23:05.595243
010898c8-1c3c-49c9-8fa1-1d28ca0f679c	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Chandwad	t	2026-07-07 15:23:05.595243
542c9e46-c6c6-48be-8c43-97e0d86dbca3	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Deola	t	2026-07-07 15:23:05.595243
82d13226-7936-4e8f-a464-c7c4bc19daec	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Dindori	t	2026-07-07 15:23:05.595243
163d2bda-636c-46b2-927b-c7be65be5741	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Igatpuri	t	2026-07-07 15:23:05.595243
a4a9cdca-f670-45e7-9ccf-1bd8230f6580	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Kalwan	t	2026-07-07 15:23:05.595243
98c6a806-1527-4ef3-ab6d-9d40ad9f35c8	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Malegaon	t	2026-07-07 15:23:05.595243
c293e451-ea34-431e-bf8e-ed7d6fde8ce6	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Nandgaon	t	2026-07-07 15:23:05.595243
78b823a5-1f51-44b4-8c71-94929b18beee	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Nashik	t	2026-07-07 15:23:05.595243
e63ce91d-6b76-415f-8619-3dd09eced0e7	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Niphad	t	2026-07-07 15:23:05.595243
eebda302-74d7-4ce0-a13f-08332708968a	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Peth	t	2026-07-07 15:23:05.595243
924241a7-0b99-456a-96fd-200e48ca5ae0	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Sinnar	t	2026-07-07 15:23:05.595243
5788549d-9066-416a-8ad7-e3271ff664cd	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Surgana	t	2026-07-07 15:23:05.595243
2cef1687-4b7d-4f0e-bdd9-7a328836fcaf	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Trimbakeshwar	t	2026-07-07 15:23:05.595243
c7387b4c-9e0c-42f6-be05-5615fb3fea58	5f56f8a3-839b-46b7-99f1-df2d1587fa67	Yeola	t	2026-07-07 15:23:05.595243
66b4fff8-76b2-4116-ba58-3a085da706e0	af848308-3b73-4bfb-a479-cf3676589c1b	Bhum	t	2026-07-07 15:23:05.595243
3919c285-2971-4727-b841-eee19c5131b8	af848308-3b73-4bfb-a479-cf3676589c1b	Kalamb	t	2026-07-07 15:23:05.595243
8ec1c01a-4408-4dc5-9adf-c0cfd3675559	af848308-3b73-4bfb-a479-cf3676589c1b	Lohara	t	2026-07-07 15:23:05.595243
d090e6ca-ba60-4908-9f8f-19c9c01e64b4	af848308-3b73-4bfb-a479-cf3676589c1b	Osmanabad	t	2026-07-07 15:23:05.595243
fc81e1d8-fa28-47ff-8010-709742edb6cb	af848308-3b73-4bfb-a479-cf3676589c1b	Paranda	t	2026-07-07 15:23:05.595243
6be840e1-95a1-4d49-8a94-f37d4858c4fd	af848308-3b73-4bfb-a479-cf3676589c1b	Tuljapur	t	2026-07-07 15:23:05.595243
22263d7a-2126-42ee-a543-9e3c01c22f86	af848308-3b73-4bfb-a479-cf3676589c1b	Umarga	t	2026-07-07 15:23:05.595243
e61536f7-f67e-4a94-a7f9-5898c8d77855	af848308-3b73-4bfb-a479-cf3676589c1b	Washi	t	2026-07-07 15:23:05.595243
b69703d4-48ff-40d9-8cca-783006e8caab	f762d55b-27ea-49a5-957e-68c145ed037a	Dahanu	t	2026-07-07 15:23:05.595243
7b441c29-e056-4c02-bb98-482d7cbbc334	f762d55b-27ea-49a5-957e-68c145ed037a	Jawhar	t	2026-07-07 15:23:05.595243
f5075fdd-fe4d-4004-ba6c-9f530ed0fc6a	f762d55b-27ea-49a5-957e-68c145ed037a	Mokhada	t	2026-07-07 15:23:05.595243
2ca2efc4-0e34-4a75-9309-37bbc01729b3	f762d55b-27ea-49a5-957e-68c145ed037a	Palghar	t	2026-07-07 15:23:05.595243
0a646812-58da-4992-823c-fef366cb2fdc	f762d55b-27ea-49a5-957e-68c145ed037a	Talasari	t	2026-07-07 15:23:05.595243
b419a226-0766-40b8-b17e-834197fe0764	f762d55b-27ea-49a5-957e-68c145ed037a	Vada	t	2026-07-07 15:23:05.595243
15792416-f0ad-4438-b040-58de6e797ade	f762d55b-27ea-49a5-957e-68c145ed037a	Vasai	t	2026-07-07 15:23:05.595243
5c04d0cc-cc5f-46a5-8310-38333d3b195a	f762d55b-27ea-49a5-957e-68c145ed037a	Vikramgad	t	2026-07-07 15:23:05.595243
f5e486a9-ad0a-4fd6-93b7-06661ae4a938	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Gangakhed	t	2026-07-07 15:23:05.595243
9fa4b211-15c7-4602-9f5a-aa3d044e7b43	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Jintur	t	2026-07-07 15:23:05.595243
579d1c5b-f048-4e42-8cc9-6a078589171f	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Manwath	t	2026-07-07 15:23:05.595243
97374b02-82c9-4a0a-8e37-2254392f79fa	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Palam	t	2026-07-07 15:23:05.595243
6763bd87-d45c-4bfc-a590-eb2914b7e455	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Parbhani	t	2026-07-07 15:23:05.595243
7fc869d2-9ab5-4c09-b01a-080070360510	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Pathri	t	2026-07-07 15:23:05.595243
d276eea2-4e62-46a4-9a30-e92ea3d77703	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Purna	t	2026-07-07 15:23:05.595243
0a1a4f72-7d32-41e8-beb8-1ded51994abb	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Sailu	t	2026-07-07 15:23:05.595243
003e0f8d-d88b-4d3f-b92c-82ab96f767ba	0a3a0fed-93c9-44c2-924c-17cb81d4013a	Sonpeth	t	2026-07-07 15:23:05.595243
0c8a6da7-59df-404b-a75d-321144ec1777	841f3e8f-5530-4833-b0d6-13343b54225a	Ambegaon	t	2026-07-07 15:23:05.595243
118dfb45-a6f9-4f55-84f4-9ec0d01f6137	841f3e8f-5530-4833-b0d6-13343b54225a	Baramati	t	2026-07-07 15:23:05.595243
4a402d6b-1258-4934-81d6-70e6d5e8d20f	841f3e8f-5530-4833-b0d6-13343b54225a	Bhor	t	2026-07-07 15:23:05.595243
1e32fc2c-0332-45bc-b976-63fd5c8eb53e	841f3e8f-5530-4833-b0d6-13343b54225a	Daund	t	2026-07-07 15:23:05.595243
d1918c4f-ee17-4cc6-a6d1-1d8c003b17da	841f3e8f-5530-4833-b0d6-13343b54225a	Haveli	t	2026-07-07 15:23:05.595243
d2d6816d-911b-4f68-8ee7-e042d41c9c77	841f3e8f-5530-4833-b0d6-13343b54225a	Indapur	t	2026-07-07 15:23:05.595243
81249d82-68f8-43d8-901a-0fcd6b4ededc	841f3e8f-5530-4833-b0d6-13343b54225a	Junnar	t	2026-07-07 15:23:05.595243
4d9ed5e9-02f4-4f33-9f2e-34a5e2309bb0	841f3e8f-5530-4833-b0d6-13343b54225a	Khed	t	2026-07-07 15:23:05.595243
14517fb0-2a0e-44c7-8390-f6c22c773336	841f3e8f-5530-4833-b0d6-13343b54225a	Maval	t	2026-07-07 15:23:05.595243
7a6dc959-a9b5-4339-8165-00038d1699b1	841f3e8f-5530-4833-b0d6-13343b54225a	Mulshi	t	2026-07-07 15:23:05.595243
4b2b9f2a-9318-441e-8f83-20fd76d39983	841f3e8f-5530-4833-b0d6-13343b54225a	Pune City	t	2026-07-07 15:23:05.595243
3bbd26f9-3f6d-4931-86b7-65382d6f2549	841f3e8f-5530-4833-b0d6-13343b54225a	Purandhar (Saswad)	t	2026-07-07 15:23:05.595243
7c444557-7d61-41eb-ae58-e8cad68357b7	841f3e8f-5530-4833-b0d6-13343b54225a	Shirur	t	2026-07-07 15:23:05.595243
d857adc0-14e8-4d94-9324-cc93263f0b60	841f3e8f-5530-4833-b0d6-13343b54225a	Velhe	t	2026-07-07 15:23:05.595243
4ff34d3d-7f71-4ccd-80f0-4cc1cb93d703	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Alibag	t	2026-07-07 15:23:05.595243
74fe3a1a-2ced-4ef9-8753-bd09d9aafbac	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Karjat	t	2026-07-07 15:23:05.595243
8ced72a5-8374-418a-be2f-bfd540792470	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Khalapur	t	2026-07-07 15:23:05.595243
43312388-0657-4c51-864c-c302d77feb00	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Mahad	t	2026-07-07 15:23:05.595243
ebcee106-1b69-4dd9-b39e-eb045fb7b61c	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Mangaon	t	2026-07-07 15:23:05.595243
7a0e0adf-94f4-4430-b6d8-0c3010d1a6bd	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Mhasala	t	2026-07-07 15:23:05.595243
a6915c83-dba2-482a-849f-725ec571de28	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Murud	t	2026-07-07 15:23:05.595243
7dd8085a-0040-45e5-b2a4-da1c0a888c94	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Panvel	t	2026-07-07 15:23:05.595243
adf308d2-16e1-4d10-a7c8-bba70d7cf336	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Pen	t	2026-07-07 15:23:05.595243
bbd73797-6f86-47a4-9ab2-ddf3eccc223c	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Poladpur	t	2026-07-07 15:23:05.595243
03105d95-346a-44b4-83b6-13ca73c47a59	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Roha	t	2026-07-07 15:23:05.595243
adebe6a1-4c1b-4a61-a4e9-18a41b2bba03	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Shrivardhan	t	2026-07-07 15:23:05.595243
63693c92-6643-40f3-b12b-cd154fc67a37	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Sudhagad-Pali	t	2026-07-07 15:23:05.595243
e2a61d9a-547f-4d6e-971c-5d4db6214523	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Tala	t	2026-07-07 15:23:05.595243
5739cd88-6b8a-4f2b-a2f7-679e9cfef213	aee83b10-bf44-4e6b-b0ce-4c8666baf9d5	Uran	t	2026-07-07 15:23:05.595243
d2223e05-1de4-476c-8482-71bb7ffc89b5	f4a7bf2d-a423-4146-ab94-406b8b16041f	Chiplun	t	2026-07-07 15:23:05.595243
438ac745-7afe-4c39-a9ba-62fd009c67a0	f4a7bf2d-a423-4146-ab94-406b8b16041f	Dapoli	t	2026-07-07 15:23:05.595243
f5615856-7927-40d7-845c-28af56e09615	f4a7bf2d-a423-4146-ab94-406b8b16041f	Guhagar	t	2026-07-07 15:23:05.595243
84e77aaf-da64-45ea-ac75-415ff135a22e	f4a7bf2d-a423-4146-ab94-406b8b16041f	Khed	t	2026-07-07 15:23:05.595243
c1d97dcb-0847-49aa-aba3-6e78d210bba8	f4a7bf2d-a423-4146-ab94-406b8b16041f	Lanja	t	2026-07-07 15:23:05.595243
62bb78c0-14a9-44c6-a51b-d642f5d4adb7	f4a7bf2d-a423-4146-ab94-406b8b16041f	Mandangad	t	2026-07-07 15:23:05.595243
a095aa4e-f80e-4e70-bed9-1a3085140eff	f4a7bf2d-a423-4146-ab94-406b8b16041f	Rajapur	t	2026-07-07 15:23:05.595243
d9334317-2dc5-4878-8dd0-3a55479a0bfa	f4a7bf2d-a423-4146-ab94-406b8b16041f	Ratnagiri	t	2026-07-07 15:23:05.595243
e13f4cd0-7e4e-4586-af61-1662ae4ebb72	f4a7bf2d-a423-4146-ab94-406b8b16041f	Sangameshwar	t	2026-07-07 15:23:05.595243
d109d3df-3021-473f-ab68-d74a2510dc16	49e809b0-43c5-4e4a-893e-df918fa2b373	Atpadi	t	2026-07-07 15:23:05.595243
52eba29c-947c-4457-97be-0b42939c4c7c	49e809b0-43c5-4e4a-893e-df918fa2b373	Jat	t	2026-07-07 15:23:05.595243
fc572e7e-763e-4031-9e9c-de5411879cab	49e809b0-43c5-4e4a-893e-df918fa2b373	Kadegaon	t	2026-07-07 15:23:05.595243
d7eb9144-2402-43b8-a38c-e71bd1182733	49e809b0-43c5-4e4a-893e-df918fa2b373	Kavathemahankal	t	2026-07-07 15:23:05.595243
6b46ec85-918a-494d-b1d2-2154df4f8171	49e809b0-43c5-4e4a-893e-df918fa2b373	Khanapur (Vita)	t	2026-07-07 15:23:05.595243
ba321877-93e2-4688-bd65-aa8a77b884e3	49e809b0-43c5-4e4a-893e-df918fa2b373	Miraj	t	2026-07-07 15:23:05.595243
788141de-bb27-4364-b75a-8584b364d78c	49e809b0-43c5-4e4a-893e-df918fa2b373	Palus	t	2026-07-07 15:23:05.595243
48b487a2-6ca9-4623-a167-c42bd0f7f7f4	49e809b0-43c5-4e4a-893e-df918fa2b373	Shirala	t	2026-07-07 15:23:05.595243
f7cf8fbf-5a34-4ffc-b47a-8e011857d558	49e809b0-43c5-4e4a-893e-df918fa2b373	Tasgaon	t	2026-07-07 15:23:05.595243
319dca78-e386-4880-bb4f-5b4bb336bf66	49e809b0-43c5-4e4a-893e-df918fa2b373	Walwa	t	2026-07-07 15:23:05.595243
a5705b59-8959-4330-a3cd-85874838eb7c	24486687-c298-49fc-a171-3691abef9372	Jaoli	t	2026-07-07 15:23:05.595243
417c3109-f342-41f3-86db-413738b4cc18	24486687-c298-49fc-a171-3691abef9372	Karad	t	2026-07-07 15:23:05.595243
b97d8c79-3fe1-4433-95bc-ebb154b63131	24486687-c298-49fc-a171-3691abef9372	Khandala	t	2026-07-07 15:23:05.595243
186e03a6-5829-4b13-a9b0-59abdd28dfd9	24486687-c298-49fc-a171-3691abef9372	Khatav	t	2026-07-07 15:23:05.595243
d238cc46-f91d-49de-9da5-66149abd6927	24486687-c298-49fc-a171-3691abef9372	Koregaon	t	2026-07-07 15:23:05.595243
83c35ac6-e224-42b0-a58a-248570ec3b6d	24486687-c298-49fc-a171-3691abef9372	Maan	t	2026-07-07 15:23:05.595243
c0ae3674-d2f7-4563-9607-3706740c6fd3	24486687-c298-49fc-a171-3691abef9372	Mahabaleshwar	t	2026-07-07 15:23:05.595243
879acdbe-1059-44df-809d-c33679a9b53e	24486687-c298-49fc-a171-3691abef9372	Patan	t	2026-07-07 15:23:05.595243
daa0c179-17e5-4f35-ac42-fd2909fecb8b	24486687-c298-49fc-a171-3691abef9372	Phaltan	t	2026-07-07 15:23:05.595243
ce862acd-6935-4521-8676-f9ac29876635	24486687-c298-49fc-a171-3691abef9372	Satara	t	2026-07-07 15:23:05.595243
1d5a035f-ac48-4068-a54c-0cd207794bb5	24486687-c298-49fc-a171-3691abef9372	Wai	t	2026-07-07 15:23:05.595243
5ccfefcc-d49b-4980-8ac6-a8659a78aa20	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Devgad	t	2026-07-07 15:23:05.595243
de852851-0058-4e53-8cd8-87eb6903465c	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Dodamarg	t	2026-07-07 15:23:05.595243
281ed8e3-f6c4-44db-a508-2d235bb7952e	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Kankavli	t	2026-07-07 15:23:05.595243
26692a37-1b7d-4e0b-b179-e27d38a83e5d	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Kudal	t	2026-07-07 15:23:05.595243
7399f9b9-9f12-43f0-9422-372f781123b5	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Malwan	t	2026-07-07 15:23:05.595243
c0aed9d6-e64b-4e0d-b450-18c656189ed3	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Sawantwadi	t	2026-07-07 15:23:05.595243
c4400440-802a-443c-8564-ae6abb0b2ffb	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Vaibhavwadi	t	2026-07-07 15:23:05.595243
db8ed432-0790-4906-ada0-7dd263e96564	0b94b4b1-98b5-40d3-9c59-460b71d02e51	Vengurla	t	2026-07-07 15:23:05.595243
ac6c506a-7d58-4f51-a5b7-c1cac5f9aa23	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Akkalkot	t	2026-07-07 15:23:05.595243
6a6ce671-4317-42db-b7b1-e6ff667ca076	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Barshi	t	2026-07-07 15:23:05.595243
aff9bb7b-5663-4885-84b9-c9975e76e9bd	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Karmala	t	2026-07-07 15:23:05.595243
2bc135a8-9dd6-4d55-b128-ac2c5bbe0196	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Madha	t	2026-07-07 15:23:05.595243
27b1da23-a5f0-43dc-89de-877063b00244	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Malshiras	t	2026-07-07 15:23:05.595243
d90eb1b4-fffe-4e7c-bd65-30aee4898ade	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Mangalvedhe	t	2026-07-07 15:23:05.595243
292b36d3-a7da-49a8-989f-d85fe35860f5	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Mohol	t	2026-07-07 15:23:05.595243
3ef78d23-4291-412e-bf2e-45346cc21ef3	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Pandharpur	t	2026-07-07 15:23:05.595243
0a266cdf-c36a-4339-99fd-7a69d74cd6f1	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Sangole	t	2026-07-07 15:23:05.595243
4c709057-b2ed-4c06-8ac5-365296851010	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Solapur North	t	2026-07-07 15:23:05.595243
3c762610-fe28-43ba-a175-c71e93a8123d	e5bea33c-4fff-4302-ac22-2c5a860ef67c	Solapur South	t	2026-07-07 15:23:05.595243
fcc803f9-fd5a-428e-877a-b66a48de965b	c23ce687-2b9e-4a46-bbbf-8517acad5616	Ambarnath	t	2026-07-07 15:23:05.595243
5c246b5d-0eab-431a-9873-b1bdcc3b70f8	c23ce687-2b9e-4a46-bbbf-8517acad5616	Bhiwandi	t	2026-07-07 15:23:05.595243
0decdf9e-a077-4b52-a746-de8ba4c06544	c23ce687-2b9e-4a46-bbbf-8517acad5616	Kalyan	t	2026-07-07 15:23:05.595243
b0f95a73-0233-4703-90a3-9d02fdf703b4	c23ce687-2b9e-4a46-bbbf-8517acad5616	Murbad	t	2026-07-07 15:23:05.595243
caf6cdcc-793c-49f3-86f5-8074e6573b9f	c23ce687-2b9e-4a46-bbbf-8517acad5616	Shahapur	t	2026-07-07 15:23:05.595243
d0d86b08-5460-4d46-a164-d9f569795262	c23ce687-2b9e-4a46-bbbf-8517acad5616	Thane	t	2026-07-07 15:23:05.595243
a108e63a-97a9-4aef-bbbf-4a569f9c2f6e	c23ce687-2b9e-4a46-bbbf-8517acad5616	Ulhasnagar	t	2026-07-07 15:23:05.595243
dc7b5a89-1ce2-44b6-b650-f84a08302ad1	767f42bc-6c33-42ba-866b-e66bb2fdead5	Arvi	t	2026-07-07 15:23:05.595243
5c44641d-e3cd-4ef6-9307-5f226ad3d606	767f42bc-6c33-42ba-866b-e66bb2fdead5	Ashti	t	2026-07-07 15:23:05.595243
86d0f1c1-3049-4633-9b43-b568da3db85e	767f42bc-6c33-42ba-866b-e66bb2fdead5	Deoli	t	2026-07-07 15:23:05.595243
503f6025-2159-42db-8311-e5ddf831f139	767f42bc-6c33-42ba-866b-e66bb2fdead5	Hinganghat	t	2026-07-07 15:23:05.595243
d0e1c7f3-c610-44a4-9934-cfcb80f0f50b	767f42bc-6c33-42ba-866b-e66bb2fdead5	Karanja	t	2026-07-07 15:23:05.595243
cde1d391-7dd3-4ff5-9c88-8cf65251961a	767f42bc-6c33-42ba-866b-e66bb2fdead5	Samudrapur	t	2026-07-07 15:23:05.595243
30674f16-e5d1-4146-857e-037346303394	767f42bc-6c33-42ba-866b-e66bb2fdead5	Seloo	t	2026-07-07 15:23:05.595243
d4600aa6-62c1-4d77-a763-e341478a2031	767f42bc-6c33-42ba-866b-e66bb2fdead5	Wardha	t	2026-07-07 15:23:05.595243
4d099976-b34a-4370-9900-d05aa87ddb08	d516d066-39a6-47dd-bd88-b3eed9c3cab4	Karanja	t	2026-07-07 15:23:05.595243
8ceda028-0dc2-4721-8446-96a54e0853b6	d516d066-39a6-47dd-bd88-b3eed9c3cab4	Malegaon	t	2026-07-07 15:23:05.595243
7e056f7f-4c0f-40d3-b622-e5a76dc194aa	d516d066-39a6-47dd-bd88-b3eed9c3cab4	Mangrulpir	t	2026-07-07 15:23:05.595243
7f4d1c31-b23b-4eb3-abe1-26983678a4ad	d516d066-39a6-47dd-bd88-b3eed9c3cab4	Manora	t	2026-07-07 15:23:05.595243
a2425402-6d58-4792-9f96-9b29607a906f	d516d066-39a6-47dd-bd88-b3eed9c3cab4	Risod	t	2026-07-07 15:23:05.595243
4c4f4901-09dc-4ba7-86c1-8998caafeb8b	d516d066-39a6-47dd-bd88-b3eed9c3cab4	Washim	t	2026-07-07 15:23:05.595243
e2ead266-81f1-412e-b33f-4acc57b46f10	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Arni	t	2026-07-07 15:23:05.595243
8c2a2e5e-76db-45fc-958d-3e8d00353f27	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Babhulgaon	t	2026-07-07 15:23:05.595243
4082ea79-c370-43ad-a6bd-0194d981bbe0	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Darwha	t	2026-07-07 15:23:05.595243
5978613c-2711-42fc-b1ae-413542e8c3b3	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Digras	t	2026-07-07 15:23:05.595243
e4927d1f-4e0d-4e12-bfe8-4bf7834a2042	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Ghatanji	t	2026-07-07 15:23:05.595243
41ede548-6862-4649-b203-54481ae39bf2	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Kalamb	t	2026-07-07 15:23:05.595243
1d175cad-6b85-44cc-bb7a-a3d4bae048e0	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Kelapur	t	2026-07-07 15:23:05.595243
3774d7ce-8185-4227-90fd-19829cdf5429	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Mahagaon	t	2026-07-07 15:23:05.595243
c9c24588-e12c-498a-a181-aeb6df8e6dc9	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Maregaon	t	2026-07-07 15:23:05.595243
dfd43400-a424-43df-acb4-1fafb3191c08	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Ner	t	2026-07-07 15:23:05.595243
4201842d-1218-43f3-808c-ee402772b0f1	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Pusad	t	2026-07-07 15:23:05.595243
c9195658-5d64-4d50-8f50-aee611a8dfa7	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Ralegaon	t	2026-07-07 15:23:05.595243
be445273-5647-49f3-8ac4-0047ba7642ce	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Umarkhed	t	2026-07-07 15:23:05.595243
4abd1f67-d9ed-4ba8-9f3e-400036d61ea8	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Wani	t	2026-07-07 15:23:05.595243
43edb552-0b4e-47e9-891a-0d9a638d5905	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Yavatmal	t	2026-07-07 15:23:05.595243
32078e33-9359-44b4-9ab3-db6290f9a920	b1fcc052-2e78-49cc-b5b2-b90355a025ed	Zari Jamani	t	2026-07-07 15:23:05.595243
\.


--
-- TOC entry 5584 (class 0 OID 142435)
-- Dependencies: 235
-- Data for Name: admin_districts; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.admin_districts (id, user_id, district_id) FROM stdin;
\.


--
-- TOC entry 5580 (class 0 OID 142383)
-- Dependencies: 231
-- Data for Name: permissions; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.permissions (id, name, created_at) FROM stdin;
\.


--
-- TOC entry 5582 (class 0 OID 142406)
-- Dependencies: 233
-- Data for Name: profile; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.profile (id, user_id, avatar_url, bio, address, city_id, state_id, created_at, updated_at) FROM stdin;
\.


--
-- TOC entry 5581 (class 0 OID 142391)
-- Dependencies: 232
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.role_permissions (role_id, permission_id) FROM stdin;
\.


--
-- TOC entry 5578 (class 0 OID 142346)
-- Dependencies: 229
-- Data for Name: roles; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.roles (id, name, created_at) FROM stdin;
09876de6-3bd6-44b0-aee5-5e35b3372390	Division Manager	2026-08-11 14:20:14.448423
3b9fc466-9f54-4e86-8580-c9e98bbb32e8	Super Admin	2026-02-24 21:04:51.91392
641344fa-da66-4e47-afef-89c1000bd4ae	Vendor	2026-02-24 21:09:42.38666
641344fa-da66-4e47-afef-89c1000bd4af	Admin	2026-02-24 21:09:42.38666
904131b7-da19-4e54-84c1-f13e7e68b4b8	User	2026-02-24 21:09:42.38666
\.


--
-- TOC entry 5630 (class 0 OID 143373)
-- Dependencies: 306
-- Data for Name: user_division_assignments; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.user_division_assignments (id, user_id, division, created_at) FROM stdin;
\.


--
-- TOC entry 5583 (class 0 OID 142422)
-- Dependencies: 234
-- Data for Name: user_listings_saves; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.user_listings_saves (id, user_id, listing_id) FROM stdin;
\.


--
-- TOC entry 5579 (class 0 OID 142355)
-- Dependencies: 230
-- Data for Name: users; Type: TABLE DATA; Schema: identityaccess; Owner: postgres
--

COPY identityaccess.users (id, role_id, name, mobile, email, first_name, last_name, password_hash, is_active, created_at, updated_at, password_salt, reset_token, reset_token_expires) FROM stdin;
\.


--
-- TOC entry 5600 (class 0 OID 142650)
-- Dependencies: 251
-- Data for Name: accommodations_rooms; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.accommodations_rooms (id, listing_id, room_title, price, room_quantity, children_capacity, adult_capacity, description, minimum_nights_required_booking) FROM stdin;
\.


--
-- TOC entry 5603 (class 0 OID 142682)
-- Dependencies: 254
-- Data for Name: accommodations_rooms_accommodations_rooms_facilities; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.accommodations_rooms_accommodations_rooms_facilities (accommodations_rooms_id, accommodations_rooms_facility_id) FROM stdin;
\.


--
-- TOC entry 5605 (class 0 OID 142703)
-- Dependencies: 256
-- Data for Name: accommodations_rooms_accommodations_rooms_photos; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.accommodations_rooms_accommodations_rooms_photos (accommodations_rooms_id, accommodations_rooms_photos_id) FROM stdin;
\.


--
-- TOC entry 5601 (class 0 OID 142663)
-- Dependencies: 252
-- Data for Name: accommodations_rooms_availability_dates; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.accommodations_rooms_availability_dates (id, accommodations_rooms_id, date, lock_room_quantity, price) FROM stdin;
\.


--
-- TOC entry 5602 (class 0 OID 142674)
-- Dependencies: 253
-- Data for Name: accommodations_rooms_facilities; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.accommodations_rooms_facilities (id, facilitiy) FROM stdin;
af000001-0000-4000-a000-000000000001	Air Conditioned
af000001-0000-4000-a000-000000000002	Airport Shuttle
af000001-0000-4000-a000-000000000003	Bar and Lounge Facilities
af000001-0000-4000-a000-000000000004	Bathtub
af000001-0000-4000-a000-000000000005	Breakfast
af000001-0000-4000-a000-000000000006	Car Rental Service
af000001-0000-4000-a000-000000000007	Currency Exchange
af000001-0000-4000-a000-000000000008	Daily Housekeeping
af000001-0000-4000-a000-000000000009	Elevator
af000001-0000-4000-a000-000000000010	Ensuite Bathroom with Shower
af000001-0000-4000-a000-000000000011	Free Parking
af000001-0000-4000-a000-000000000012	Free Wi Fi
af000001-0000-4000-a000-000000000013	Front Desk Assistance (24/7)
af000001-0000-4000-a000-000000000014	Gym
af000001-0000-4000-a000-000000000015	In-room Entertainment
af000001-0000-4000-a000-000000000016	Laundry and Dry Cleaning
af000001-0000-4000-a000-000000000017	Mini Bar
af000001-0000-4000-a000-000000000018	Mini refrigerator/Mini Bar
af000001-0000-4000-a000-000000000019	Jacuzzi
af000001-0000-4000-a000-000000000020	Non-smoking
af000001-0000-4000-a000-000000000021	On site Restaurant
af000001-0000-4000-a000-000000000022	Pet Friendly
af000001-0000-4000-a000-000000000023	Recreational Activities
af000001-0000-4000-a000-000000000024	Single Bed
af000001-0000-4000-a000-000000000025	Smoke-Detector
af000001-0000-4000-a000-000000000026	Spa & Wellness Center
af000001-0000-4000-a000-000000000027	Swimming Pool
af000001-0000-4000-a000-000000000028	Telephone with direct dial
af000001-0000-4000-a000-000000000029	Twin Bed
af000001-0000-4000-a000-000000000030	Wake-up call
af000001-0000-4000-a000-000000000031	Wheelchair Friendly
\.


--
-- TOC entry 5604 (class 0 OID 142695)
-- Dependencies: 255
-- Data for Name: accommodations_rooms_photos; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.accommodations_rooms_photos (id, image_url, featured) FROM stdin;
\.


--
-- TOC entry 5592 (class 0 OID 142545)
-- Dependencies: 243
-- Data for Name: additional_service_fees; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.additional_service_fees (id, listing_id, service_name, description, service_price) FROM stdin;
\.


--
-- TOC entry 5615 (class 0 OID 142826)
-- Dependencies: 266
-- Data for Name: aqua_tourism_tour_dates; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.aqua_tourism_tour_dates (id, listing_id, start_date, start_time, end_date, end_time) FROM stdin;
\.


--
-- TOC entry 5614 (class 0 OID 142813)
-- Dependencies: 265
-- Data for Name: aqua_tourism_tour_package; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.aqua_tourism_tour_package (id, listing_id, tour_package_name, description, price, quantity_available, minimum_quantity) FROM stdin;
\.


--
-- TOC entry 5624 (class 0 OID 142929)
-- Dependencies: 275
-- Data for Name: available_dates; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.available_dates (id, listing_id, date, available, start_time, end_date) FROM stdin;
\.


--
-- TOC entry 5590 (class 0 OID 142519)
-- Dependencies: 241
-- Data for Name: business_documents; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.business_documents (id, listing_id, tour_guide_license_number, tour_registration_number, about_business, registered_for_travel_for_life, registered_for_green_leaf_rating, award_in_tourism_sector, udyog_aadhar_card_document_url, aadhar_card_document_url, pan_card_document_url, cancelled_cheque_document_url, document_name_one, document_name_one_url, document_name_two, document_name_two_url) FROM stdin;
\.


--
-- TOC entry 5585 (class 0 OID 142449)
-- Dependencies: 236
-- Data for Name: categories; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.categories (id, name) FROM stdin;
24f3916c-a227-42b6-86d5-cb493b0e0a4a	Accommodations
7110589d-e6dc-441c-9c76-25b2e5579be5	Experiences and Activities Slots
d42e5f37-7769-480b-8d88-4d8f2ae11a70	Tour Guide
09247453-eec9-4e8b-9b19-219e07813b00	Cuisine
c4e5ba48-90e8-4107-9abb-c3188c07ae18	Experiences and Activities
9e801ff4-9dd0-48a8-81cc-660f5457158b	Tour Operator, Travel Agent and Destination Management Company
f64bf634-df9e-4787-897d-e06b7380f724	Aqua Tourism
3c387b3f-259f-4eca-a702-b3fb85317dee	Guided Tours
86841a14-6545-4287-96ee-009a5e3063ab	Events and Festivals
0b5503ae-7861-49df-ab1e-747b356f15fa	Handicrafts and Souvenirs
\.


--
-- TOC entry 5616 (class 0 OID 142837)
-- Dependencies: 267
-- Data for Name: company_packages; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.company_packages (id, listing_id, tour_package_name, description, price, quantity_available, minimum_quantity, destination_from, destination_to) FROM stdin;
\.


--
-- TOC entry 5594 (class 0 OID 142571)
-- Dependencies: 245
-- Data for Name: contact_details; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.contact_details (id, listing_id, business_address, village_name, city_name, taluka_name, district_name, pin_code, state_name, country_name, working_address, latitude, longitude, email_address, mobile_number, landline_number, country_code, alternate_email_address, alternate_mobile_number) FROM stdin;
\.


--
-- TOC entry 5593 (class 0 OID 142558)
-- Dependencies: 244
-- Data for Name: coupons; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.coupons (id, listing_id, coupon_code, discount_type, discount_amount, coupon_quantity, coupon_expiry_date, description) FROM stdin;
\.


--
-- TOC entry 5609 (class 0 OID 142753)
-- Dependencies: 260
-- Data for Name: cuisine_menu; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.cuisine_menu (id, listing_id, menu_name, menu_price, menu_link_url, menu_types, menu_description) FROM stdin;
\.


--
-- TOC entry 5611 (class 0 OID 142774)
-- Dependencies: 262
-- Data for Name: cuisine_menu_cuisine_menu_photos; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.cuisine_menu_cuisine_menu_photos (cuisine_menu_id, cuisine_menu_photos_id) FROM stdin;
\.


--
-- TOC entry 5610 (class 0 OID 142766)
-- Dependencies: 261
-- Data for Name: cuisine_menu_photos; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.cuisine_menu_photos (id, photo_url) FROM stdin;
\.


--
-- TOC entry 5607 (class 0 OID 142729)
-- Dependencies: 258
-- Data for Name: event_experiences_tickets; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.event_experiences_tickets (id, listing_id, ticket_name, ticket_price, ticket_quantity_available, minimum_quantity, description) FROM stdin;
\.


--
-- TOC entry 5608 (class 0 OID 142742)
-- Dependencies: 259
-- Data for Name: event_experiences_timeslots; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.event_experiences_timeslots (id, fromtime, totime, listing_id, available_slots) FROM stdin;
\.


--
-- TOC entry 5620 (class 0 OID 142887)
-- Dependencies: 271
-- Data for Name: events_festivals_performers; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.events_festivals_performers (id, listing_id, name, job_or_position, website_url, description, image_url) FROM stdin;
\.


--
-- TOC entry 5621 (class 0 OID 142900)
-- Dependencies: 272
-- Data for Name: events_festivals_performers_social_urls; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.events_festivals_performers_social_urls (id, name, social_url) FROM stdin;
\.


--
-- TOC entry 5622 (class 0 OID 142908)
-- Dependencies: 273
-- Data for Name: events_festivals_performers_urls; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.events_festivals_performers_urls (events_festivals_performers, events_festivals_performers_social_urls_id) FROM stdin;
\.


--
-- TOC entry 5619 (class 0 OID 142874)
-- Dependencies: 270
-- Data for Name: events_festivals_pricing; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.events_festivals_pricing (id, listing_id, free, third_party_registration_url, listing_quantities, start_date, start_time, end_date, end_time) FROM stdin;
\.


--
-- TOC entry 5618 (class 0 OID 142863)
-- Dependencies: 269
-- Data for Name: experiences_activities_slots_pricing; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.experiences_activities_slots_pricing (id, listing_id, adult_price, children_price, foreigner_price) FROM stdin;
\.


--
-- TOC entry 5595 (class 0 OID 142589)
-- Dependencies: 246
-- Data for Name: facilities; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.facilities (id, facilitiy) FROM stdin;
15788e9e-a837-4a35-b6b7-748c4d299677	Free Parking
7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e	Free Wi Fi
fa100001-0000-4000-a000-000000000001	Air Conditioned
00e85d99-ceda-44b2-905d-326b8cde7fa6	On site Restaurant
e4930040-c93e-41e5-967f-2aa3327f69dc	Wheelchair Friendly
fa100001-0000-4000-a000-000000000002	Breakfast
fa100001-0000-4000-a000-000000000003	Smoke-Detector
27ea25bf-a4cd-48ee-b273-0ddc6fe52069	Pet Friendly
4ac82f74-e786-4a77-be30-51b5e36114fe	Elevator
95725010-2a50-4eac-aa94-0e13f3c68e63	Airport Shuttle
49c8ae02-468b-41c0-8f7e-a4c4dcd6cb9a	Bar and Lounge Facilities
fdd0a907-8f4e-4125-a85e-bfbb4af0ed52	Currency Exchange
4e130037-d0dc-4b7d-84b8-5d590d9bc974	Daily Housekeeping
3e0e446a-6ef3-4988-800d-fa98af124fb6	Car Rental Service
144fa302-9b0c-41f6-aceb-11024963213b	Front Desk Assistance (24/7)
556101d4-bc20-4db3-a026-a009b42cf5e9	Gym
f8edf61d-7f66-4902-8304-817fbaef422d	Laundry and Dry Cleaning
bac2a348-5335-44f8-981b-99285f174012	Recreational Activities
ceb9e48b-b24c-4166-9c36-1c7af8f95030	Spa & Wellness Center
8243e4f7-4f56-4f94-926f-18a6183d4a5a	Swimming Pool
c218df73-688b-4d32-8455-8dbc2c877190	Wake-up call
fa100002-0000-4000-a000-000000000001	Mini Bar
fa100002-0000-4000-a000-000000000002	Mini refrigerator/Mini Bar
fa100002-0000-4000-a000-000000000003	Non-smoking
\.


--
-- TOC entry 5589 (class 0 OID 142506)
-- Dependencies: 240
-- Data for Name: faqs; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.faqs (id, listing_id, question, answer) FROM stdin;
\.


--
-- TOC entry 5617 (class 0 OID 142850)
-- Dependencies: 268
-- Data for Name: guided_tours_tour_packages; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.guided_tours_tour_packages (id, listing_id, tour_package_name, description, price, quantity_available, minimum_quantity) FROM stdin;
\.


--
-- TOC entry 5612 (class 0 OID 142787)
-- Dependencies: 263
-- Data for Name: handicrafts_souvenirs_documents; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.handicrafts_souvenirs_documents (id, listing_id, document_one_name, document_one_url, document_two_name, document_two_url, document_three_name, document_three_url, tour_guide_registration_number, registered_for_travel_for_life, registered_for_green_lead_rating, received_award_in_tourism_sector, award_name) FROM stdin;
\.


--
-- TOC entry 5613 (class 0 OID 142800)
-- Dependencies: 264
-- Data for Name: handicrafts_souvenirs_tour_packages; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.handicrafts_souvenirs_tour_packages (id, listing_id, tour_package_name, description, price, quantity_available, minimum_quantity) FROM stdin;
\.


--
-- TOC entry 5596 (class 0 OID 142597)
-- Dependencies: 247
-- Data for Name: listing_facility; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.listing_facility (category_id, facility_id) FROM stdin;
24f3916c-a227-42b6-86d5-cb493b0e0a4a	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
24f3916c-a227-42b6-86d5-cb493b0e0a4a	00e85d99-ceda-44b2-905d-326b8cde7fa6
24f3916c-a227-42b6-86d5-cb493b0e0a4a	e4930040-c93e-41e5-967f-2aa3327f69dc
24f3916c-a227-42b6-86d5-cb493b0e0a4a	15788e9e-a837-4a35-b6b7-748c4d299677
24f3916c-a227-42b6-86d5-cb493b0e0a4a	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
24f3916c-a227-42b6-86d5-cb493b0e0a4a	4ac82f74-e786-4a77-be30-51b5e36114fe
24f3916c-a227-42b6-86d5-cb493b0e0a4a	95725010-2a50-4eac-aa94-0e13f3c68e63
24f3916c-a227-42b6-86d5-cb493b0e0a4a	49c8ae02-468b-41c0-8f7e-a4c4dcd6cb9a
24f3916c-a227-42b6-86d5-cb493b0e0a4a	fdd0a907-8f4e-4125-a85e-bfbb4af0ed52
24f3916c-a227-42b6-86d5-cb493b0e0a4a	4e130037-d0dc-4b7d-84b8-5d590d9bc974
24f3916c-a227-42b6-86d5-cb493b0e0a4a	3e0e446a-6ef3-4988-800d-fa98af124fb6
24f3916c-a227-42b6-86d5-cb493b0e0a4a	144fa302-9b0c-41f6-aceb-11024963213b
24f3916c-a227-42b6-86d5-cb493b0e0a4a	556101d4-bc20-4db3-a026-a009b42cf5e9
24f3916c-a227-42b6-86d5-cb493b0e0a4a	f8edf61d-7f66-4902-8304-817fbaef422d
24f3916c-a227-42b6-86d5-cb493b0e0a4a	bac2a348-5335-44f8-981b-99285f174012
24f3916c-a227-42b6-86d5-cb493b0e0a4a	ceb9e48b-b24c-4166-9c36-1c7af8f95030
24f3916c-a227-42b6-86d5-cb493b0e0a4a	8243e4f7-4f56-4f94-926f-18a6183d4a5a
24f3916c-a227-42b6-86d5-cb493b0e0a4a	c218df73-688b-4d32-8455-8dbc2c877190
09247453-eec9-4e8b-9b19-219e07813b00	00e85d99-ceda-44b2-905d-326b8cde7fa6
09247453-eec9-4e8b-9b19-219e07813b00	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
09247453-eec9-4e8b-9b19-219e07813b00	15788e9e-a837-4a35-b6b7-748c4d299677
09247453-eec9-4e8b-9b19-219e07813b00	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
09247453-eec9-4e8b-9b19-219e07813b00	49c8ae02-468b-41c0-8f7e-a4c4dcd6cb9a
09247453-eec9-4e8b-9b19-219e07813b00	fa100001-0000-4000-a000-000000000001
09247453-eec9-4e8b-9b19-219e07813b00	fa100002-0000-4000-a000-000000000001
09247453-eec9-4e8b-9b19-219e07813b00	fa100002-0000-4000-a000-000000000002
09247453-eec9-4e8b-9b19-219e07813b00	fa100002-0000-4000-a000-000000000003
c4e5ba48-90e8-4107-9abb-c3188c07ae18	15788e9e-a837-4a35-b6b7-748c4d299677
c4e5ba48-90e8-4107-9abb-c3188c07ae18	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
c4e5ba48-90e8-4107-9abb-c3188c07ae18	fa100001-0000-4000-a000-000000000001
c4e5ba48-90e8-4107-9abb-c3188c07ae18	00e85d99-ceda-44b2-905d-326b8cde7fa6
c4e5ba48-90e8-4107-9abb-c3188c07ae18	e4930040-c93e-41e5-967f-2aa3327f69dc
c4e5ba48-90e8-4107-9abb-c3188c07ae18	fa100001-0000-4000-a000-000000000002
c4e5ba48-90e8-4107-9abb-c3188c07ae18	fa100001-0000-4000-a000-000000000003
c4e5ba48-90e8-4107-9abb-c3188c07ae18	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
d42e5f37-7769-480b-8d88-4d8f2ae11a70	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
d42e5f37-7769-480b-8d88-4d8f2ae11a70	fa100001-0000-4000-a000-000000000001
d42e5f37-7769-480b-8d88-4d8f2ae11a70	fa100001-0000-4000-a000-000000000002
d42e5f37-7769-480b-8d88-4d8f2ae11a70	fa100002-0000-4000-a000-000000000003
d42e5f37-7769-480b-8d88-4d8f2ae11a70	fdd0a907-8f4e-4125-a85e-bfbb4af0ed52
d42e5f37-7769-480b-8d88-4d8f2ae11a70	e4930040-c93e-41e5-967f-2aa3327f69dc
f64bf634-df9e-4787-897d-e06b7380f724	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
f64bf634-df9e-4787-897d-e06b7380f724	00e85d99-ceda-44b2-905d-326b8cde7fa6
f64bf634-df9e-4787-897d-e06b7380f724	e4930040-c93e-41e5-967f-2aa3327f69dc
f64bf634-df9e-4787-897d-e06b7380f724	15788e9e-a837-4a35-b6b7-748c4d299677
f64bf634-df9e-4787-897d-e06b7380f724	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
f64bf634-df9e-4787-897d-e06b7380f724	4ac82f74-e786-4a77-be30-51b5e36114fe
f64bf634-df9e-4787-897d-e06b7380f724	95725010-2a50-4eac-aa94-0e13f3c68e63
f64bf634-df9e-4787-897d-e06b7380f724	49c8ae02-468b-41c0-8f7e-a4c4dcd6cb9a
f64bf634-df9e-4787-897d-e06b7380f724	4e130037-d0dc-4b7d-84b8-5d590d9bc974
f64bf634-df9e-4787-897d-e06b7380f724	3e0e446a-6ef3-4988-800d-fa98af124fb6
f64bf634-df9e-4787-897d-e06b7380f724	144fa302-9b0c-41f6-aceb-11024963213b
f64bf634-df9e-4787-897d-e06b7380f724	556101d4-bc20-4db3-a026-a009b42cf5e9
f64bf634-df9e-4787-897d-e06b7380f724	f8edf61d-7f66-4902-8304-817fbaef422d
f64bf634-df9e-4787-897d-e06b7380f724	bac2a348-5335-44f8-981b-99285f174012
f64bf634-df9e-4787-897d-e06b7380f724	ceb9e48b-b24c-4166-9c36-1c7af8f95030
f64bf634-df9e-4787-897d-e06b7380f724	8243e4f7-4f56-4f94-926f-18a6183d4a5a
f64bf634-df9e-4787-897d-e06b7380f724	c218df73-688b-4d32-8455-8dbc2c877190
f64bf634-df9e-4787-897d-e06b7380f724	fa100002-0000-4000-a000-000000000003
f64bf634-df9e-4787-897d-e06b7380f724	fdd0a907-8f4e-4125-a85e-bfbb4af0ed52
7110589d-e6dc-441c-9c76-25b2e5579be5	15788e9e-a837-4a35-b6b7-748c4d299677
7110589d-e6dc-441c-9c76-25b2e5579be5	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
7110589d-e6dc-441c-9c76-25b2e5579be5	fa100001-0000-4000-a000-000000000001
7110589d-e6dc-441c-9c76-25b2e5579be5	00e85d99-ceda-44b2-905d-326b8cde7fa6
7110589d-e6dc-441c-9c76-25b2e5579be5	e4930040-c93e-41e5-967f-2aa3327f69dc
7110589d-e6dc-441c-9c76-25b2e5579be5	fa100001-0000-4000-a000-000000000002
7110589d-e6dc-441c-9c76-25b2e5579be5	fa100001-0000-4000-a000-000000000003
7110589d-e6dc-441c-9c76-25b2e5579be5	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
3c387b3f-259f-4eca-a702-b3fb85317dee	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
3c387b3f-259f-4eca-a702-b3fb85317dee	00e85d99-ceda-44b2-905d-326b8cde7fa6
3c387b3f-259f-4eca-a702-b3fb85317dee	e4930040-c93e-41e5-967f-2aa3327f69dc
3c387b3f-259f-4eca-a702-b3fb85317dee	15788e9e-a837-4a35-b6b7-748c4d299677
3c387b3f-259f-4eca-a702-b3fb85317dee	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
3c387b3f-259f-4eca-a702-b3fb85317dee	4ac82f74-e786-4a77-be30-51b5e36114fe
3c387b3f-259f-4eca-a702-b3fb85317dee	95725010-2a50-4eac-aa94-0e13f3c68e63
3c387b3f-259f-4eca-a702-b3fb85317dee	49c8ae02-468b-41c0-8f7e-a4c4dcd6cb9a
3c387b3f-259f-4eca-a702-b3fb85317dee	fdd0a907-8f4e-4125-a85e-bfbb4af0ed52
3c387b3f-259f-4eca-a702-b3fb85317dee	4e130037-d0dc-4b7d-84b8-5d590d9bc974
3c387b3f-259f-4eca-a702-b3fb85317dee	3e0e446a-6ef3-4988-800d-fa98af124fb6
3c387b3f-259f-4eca-a702-b3fb85317dee	144fa302-9b0c-41f6-aceb-11024963213b
3c387b3f-259f-4eca-a702-b3fb85317dee	556101d4-bc20-4db3-a026-a009b42cf5e9
3c387b3f-259f-4eca-a702-b3fb85317dee	f8edf61d-7f66-4902-8304-817fbaef422d
3c387b3f-259f-4eca-a702-b3fb85317dee	bac2a348-5335-44f8-981b-99285f174012
3c387b3f-259f-4eca-a702-b3fb85317dee	ceb9e48b-b24c-4166-9c36-1c7af8f95030
3c387b3f-259f-4eca-a702-b3fb85317dee	8243e4f7-4f56-4f94-926f-18a6183d4a5a
3c387b3f-259f-4eca-a702-b3fb85317dee	c218df73-688b-4d32-8455-8dbc2c877190
3c387b3f-259f-4eca-a702-b3fb85317dee	fa100002-0000-4000-a000-000000000003
9e801ff4-9dd0-48a8-81cc-660f5457158b	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
9e801ff4-9dd0-48a8-81cc-660f5457158b	fa100001-0000-4000-a000-000000000001
9e801ff4-9dd0-48a8-81cc-660f5457158b	fa100001-0000-4000-a000-000000000002
9e801ff4-9dd0-48a8-81cc-660f5457158b	fa100002-0000-4000-a000-000000000003
9e801ff4-9dd0-48a8-81cc-660f5457158b	fdd0a907-8f4e-4125-a85e-bfbb4af0ed52
9e801ff4-9dd0-48a8-81cc-660f5457158b	e4930040-c93e-41e5-967f-2aa3327f69dc
86841a14-6545-4287-96ee-009a5e3063ab	27ea25bf-a4cd-48ee-b273-0ddc6fe52069
86841a14-6545-4287-96ee-009a5e3063ab	00e85d99-ceda-44b2-905d-326b8cde7fa6
86841a14-6545-4287-96ee-009a5e3063ab	e4930040-c93e-41e5-967f-2aa3327f69dc
86841a14-6545-4287-96ee-009a5e3063ab	15788e9e-a837-4a35-b6b7-748c4d299677
86841a14-6545-4287-96ee-009a5e3063ab	7c063262-b03d-4dd6-b8d9-8fbcbddd4c7e
86841a14-6545-4287-96ee-009a5e3063ab	4ac82f74-e786-4a77-be30-51b5e36114fe
86841a14-6545-4287-96ee-009a5e3063ab	95725010-2a50-4eac-aa94-0e13f3c68e63
86841a14-6545-4287-96ee-009a5e3063ab	49c8ae02-468b-41c0-8f7e-a4c4dcd6cb9a
86841a14-6545-4287-96ee-009a5e3063ab	fdd0a907-8f4e-4125-a85e-bfbb4af0ed52
86841a14-6545-4287-96ee-009a5e3063ab	4e130037-d0dc-4b7d-84b8-5d590d9bc974
86841a14-6545-4287-96ee-009a5e3063ab	3e0e446a-6ef3-4988-800d-fa98af124fb6
86841a14-6545-4287-96ee-009a5e3063ab	144fa302-9b0c-41f6-aceb-11024963213b
86841a14-6545-4287-96ee-009a5e3063ab	556101d4-bc20-4db3-a026-a009b42cf5e9
86841a14-6545-4287-96ee-009a5e3063ab	f8edf61d-7f66-4902-8304-817fbaef422d
86841a14-6545-4287-96ee-009a5e3063ab	bac2a348-5335-44f8-981b-99285f174012
86841a14-6545-4287-96ee-009a5e3063ab	ceb9e48b-b24c-4166-9c36-1c7af8f95030
86841a14-6545-4287-96ee-009a5e3063ab	8243e4f7-4f56-4f94-926f-18a6183d4a5a
86841a14-6545-4287-96ee-009a5e3063ab	c218df73-688b-4d32-8455-8dbc2c877190
86841a14-6545-4287-96ee-009a5e3063ab	fa100002-0000-4000-a000-000000000003
\.


--
-- TOC entry 5587 (class 0 OID 142473)
-- Dependencies: 238
-- Data for Name: listings; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.listings (id, user_id, slug, category_id, name_of_business, name_of_owner, website_url, aadhar_number, gst_number, fssai_number, display_image_url, header_slider, description, tour_policies, agree_terms_conditions, declare_information_correct, financial_losses_risk_decleration, save_listing_as_pending, listing_category_id, subcategory_other_name, no_of_male_employees, no_of_female_employees, udyam_aadhar_registration_number, max_guest_capacity, booking_note, accommodation_sale_off, approval_status, platform_fee_status, view_count, admin_remark, created_at, updated_at, is_archived, archived_at, registration_number) FROM stdin;
\.


--
-- TOC entry 5625 (class 0 OID 142963)
-- Dependencies: 276
-- Data for Name: search_analytics; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.search_analytics (id, keyword, category, district, search_count, last_searched_at, created_at) FROM stdin;
\.


--
-- TOC entry 5597 (class 0 OID 142610)
-- Dependencies: 248
-- Data for Name: selected_facilities; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.selected_facilities (listing_id, facility_id) FROM stdin;
\.


--
-- TOC entry 5591 (class 0 OID 142532)
-- Dependencies: 242
-- Data for Name: social_urls; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.social_urls (id, listing_id, name, social_url) FROM stdin;
\.


--
-- TOC entry 5623 (class 0 OID 142921)
-- Dependencies: 274
-- Data for Name: social_websites; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.social_websites (id, name) FROM stdin;
a0000001-0000-4000-a000-000000000001	Facebook
a0000001-0000-4000-a000-000000000002	Twitter
a0000001-0000-4000-a000-000000000003	Youtube
a0000001-0000-4000-a000-000000000004	Vimeo
a0000001-0000-4000-a000-000000000005	Instagram
a0000001-0000-4000-a000-000000000006	Vkontakte
a0000001-0000-4000-a000-000000000007	Reddit
a0000001-0000-4000-a000-000000000008	Pinterest
a0000001-0000-4000-a000-000000000009	Vine Camera
a0000001-0000-4000-a000-000000000010	Tumblr
a0000001-0000-4000-a000-000000000011	Flickr
a0000001-0000-4000-a000-000000000012	Google+
a0000001-0000-4000-a000-000000000013	LinkedIn
a0000001-0000-4000-a000-000000000014	Whatsapp
a0000001-0000-4000-a000-000000000015	Meetup
a0000001-0000-4000-a000-000000000016	Odnoklassniki
a0000001-0000-4000-a000-000000000017	Email
a0000001-0000-4000-a000-000000000018	Telegram
a0000001-0000-4000-a000-000000000019	Custom
\.


--
-- TOC entry 5586 (class 0 OID 142460)
-- Dependencies: 237
-- Data for Name: sub_categories; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.sub_categories (id, category_id, subcategory) FROM stdin;
427bbcf5-d7fb-4153-9a4f-45187427f836	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Hotels
bd5c30a4-ded5-4115-be3f-4ee9244471a0	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Resort
6c051b79-8514-4aed-bc3a-c644cf84b2e2	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Agro Tourism / Farm Stay
85606949-7090-4671-8ace-81c2d01350da	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Apartments
687f5279-30c2-4e8c-8b22-12e654155d9e	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Hostels
add32a64-1740-4988-b788-28a5273d5ba9	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Tourism Villas
36df553d-d2f7-45a5-b0a8-930d37129103	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Tree House
18372fbe-d55a-4194-bd3a-72f477ce7cb1	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Tented Accommodation
b08e4a91-0e64-4579-b648-eb3c6599e2b7	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Home Stay
f702e574-77d4-4878-a903-65daebc52a14	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Bed and Breakfast
4e3496ca-b10f-4fba-a8a1-d502ee08ad2d	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Log Huts
a55e0ee5-261a-4f03-8c22-13739b507266	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Staycations
eae15aac-ef29-4aeb-8666-bd2a3f08289b	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Camping Sites
66264323-43cd-48fc-ac15-82c0baf4719c	24f3916c-a227-42b6-86d5-cb493b0e0a4a	Others
3f8a1b2c-4d5e-4f6a-8b9c-d0e1f2a3b4c5	09247453-eec9-4e8b-9b19-219e07813b00	Restaurant
5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d	09247453-eec9-4e8b-9b19-219e07813b00	Food Safaris
7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a	09247453-eec9-4e8b-9b19-219e07813b00	Authentic Food/Cuisines
9f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c	09247453-eec9-4e8b-9b19-219e07813b00	Cafeterias
b1c2d3e4-f5a6-4b7c-8d8e-9f0a1b2c3d4e	09247453-eec9-4e8b-9b19-219e07813b00	Others
a1b2c3d4-1111-4a7b-8c9d-ea001001001a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Adventure Activities
a1b2c3d4-1111-4a7b-8c9d-ea001001002a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Caravan
a1b2c3d4-1111-4a7b-8c9d-ea001001003a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Caves
a1b2c3d4-1111-4a7b-8c9d-ea001001004a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Cultural
a1b2c3d4-1111-4a7b-8c9d-ea001001005a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Museums
a1b2c3d4-1111-4a7b-8c9d-ea001001006a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Spiritual
a1b2c3d4-1111-4a7b-8c9d-ea001001007a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Theme Parks
a1b2c3d4-1111-4a7b-8c9d-ea001001008a	c4e5ba48-90e8-4107-9abb-c3188c07ae18	Others
b2c3d4e5-2222-4b8c-9d0e-fb002002001b	7110589d-e6dc-441c-9c76-25b2e5579be5	Adventure Activities
b2c3d4e5-2222-4b8c-9d0e-fb002002002b	7110589d-e6dc-441c-9c76-25b2e5579be5	Caravan
b2c3d4e5-2222-4b8c-9d0e-fb002002003b	7110589d-e6dc-441c-9c76-25b2e5579be5	Caves
b2c3d4e5-2222-4b8c-9d0e-fb002002004b	7110589d-e6dc-441c-9c76-25b2e5579be5	Cultural
b2c3d4e5-2222-4b8c-9d0e-fb002002005b	7110589d-e6dc-441c-9c76-25b2e5579be5	Museums
b2c3d4e5-2222-4b8c-9d0e-fb002002006b	7110589d-e6dc-441c-9c76-25b2e5579be5	Spiritual
b2c3d4e5-2222-4b8c-9d0e-fb002002007b	7110589d-e6dc-441c-9c76-25b2e5579be5	Theme Parks
b2c3d4e5-2222-4b8c-9d0e-fb002002008b	7110589d-e6dc-441c-9c76-25b2e5579be5	Others
c3d4e5f6-3333-4c9d-ae1f-0c003003001c	3c387b3f-259f-4eca-a702-b3fb85317dee	Cave Tours
c3d4e5f6-3333-4c9d-ae1f-0c003003002c	3c387b3f-259f-4eca-a702-b3fb85317dee	Educational Tours
c3d4e5f6-3333-4c9d-ae1f-0c003003003c	3c387b3f-259f-4eca-a702-b3fb85317dee	Food Testing & Culinary Tours
c3d4e5f6-3333-4c9d-ae1f-0c003003004c	3c387b3f-259f-4eca-a702-b3fb85317dee	Historical/Landmark Tours
c3d4e5f6-3333-4c9d-ae1f-0c003003005c	3c387b3f-259f-4eca-a702-b3fb85317dee	Tour
c3d4e5f6-3333-4c9d-ae1f-0c003003006c	3c387b3f-259f-4eca-a702-b3fb85317dee	Others
d4e5f6a7-4444-4dae-bf20-0d004004001d	f64bf634-df9e-4787-897d-e06b7380f724	Yachts
d4e5f6a7-4444-4dae-bf20-0d004004002d	f64bf634-df9e-4787-897d-e06b7380f724	Houseboats
d4e5f6a7-4444-4dae-bf20-0d004004003d	f64bf634-df9e-4787-897d-e06b7380f724	Ferries
d4e5f6a7-4444-4dae-bf20-0d004004004d	f64bf634-df9e-4787-897d-e06b7380f724	Sky Dive
d4e5f6a7-4444-4dae-bf20-0d004004005d	f64bf634-df9e-4787-897d-e06b7380f724	Jet Ski
d4e5f6a7-4444-4dae-bf20-0d004004006d	f64bf634-df9e-4787-897d-e06b7380f724	Rafting
d4e5f6a7-4444-4dae-bf20-0d004004007d	f64bf634-df9e-4787-897d-e06b7380f724	Scuba Diving
d4e5f6a7-4444-4dae-bf20-0d004004008d	f64bf634-df9e-4787-897d-e06b7380f724	Water Parks
d4e5f6a7-4444-4dae-bf20-0d004004009d	f64bf634-df9e-4787-897d-e06b7380f724	Helicopter Rides
d4e5f6a7-4444-4dae-bf20-0d004004010d	f64bf634-df9e-4787-897d-e06b7380f724	Others
e5f6a7b8-5555-4ebf-d031-0e005005001e	86841a14-6545-4287-96ee-009a5e3063ab	Art
e5f6a7b8-5555-4ebf-d031-0e005005002e	86841a14-6545-4287-96ee-009a5e3063ab	Cultural
e5f6a7b8-5555-4ebf-d031-0e005005003e	86841a14-6545-4287-96ee-009a5e3063ab	Exhibitions / Conferences
e5f6a7b8-5555-4ebf-d031-0e005005004e	86841a14-6545-4287-96ee-009a5e3063ab	Folk Art & Culture
e5f6a7b8-5555-4ebf-d031-0e005005005e	86841a14-6545-4287-96ee-009a5e3063ab	Food
e5f6a7b8-5555-4ebf-d031-0e005005006e	86841a14-6545-4287-96ee-009a5e3063ab	International Trade Fairs
e5f6a7b8-5555-4ebf-d031-0e005005007e	86841a14-6545-4287-96ee-009a5e3063ab	Music Concerts
e5f6a7b8-5555-4ebf-d031-0e005005008e	86841a14-6545-4287-96ee-009a5e3063ab	MICE
e5f6a7b8-5555-4ebf-d031-0e005005009e	86841a14-6545-4287-96ee-009a5e3063ab	Others
f6a7b8c9-6666-4fc0-e142-0f006006001f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Cave Tours
f6a7b8c9-6666-4fc0-e142-0f006006002f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Day Tours
f6a7b8c9-6666-4fc0-e142-0f006006003f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Educational Tours
f6a7b8c9-6666-4fc0-e142-0f006006004f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Film City Tours
f6a7b8c9-6666-4fc0-e142-0f006006005f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Historical/Landmark Tours
f6a7b8c9-6666-4fc0-e142-0f006006006f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Guided Tours
f6a7b8c9-6666-4fc0-e142-0f006006007f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Food Tour
f6a7b8c9-6666-4fc0-e142-0f006006008f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Food Testing & Culinary Tours
f6a7b8c9-6666-4fc0-e142-0f006006009f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Industrial Tours
f6a7b8c9-6666-4fc0-e142-0f006006010f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Mining Tours
f6a7b8c9-6666-4fc0-e142-0f006006011f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Special/Unique Tours
f6a7b8c9-6666-4fc0-e142-0f006006012f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Tour
f6a7b8c9-6666-4fc0-e142-0f006006013f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Holiday Tours
f6a7b8c9-6666-4fc0-e142-0f006006014f	9e801ff4-9dd0-48a8-81cc-660f5457158b	Car Rental
\.


--
-- TOC entry 5606 (class 0 OID 142716)
-- Dependencies: 257
-- Data for Name: tour_packages; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.tour_packages (id, listing_id, tour_package_name, description, price, no_of_people_per_batch, minimum_quantity) FROM stdin;
\.


--
-- TOC entry 5598 (class 0 OID 142626)
-- Dependencies: 249
-- Data for Name: working_hours; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.working_hours (id, listing_id, day_of_week, open_all_day, close_all_day, open_specific_hours) FROM stdin;
\.


--
-- TOC entry 5599 (class 0 OID 142639)
-- Dependencies: 250
-- Data for Name: working_hours_specific; Type: TABLE DATA; Schema: listing; Owner: postgres
--

COPY listing.working_hours_specific (id, working_hours_id, from_time, to_time) FROM stdin;
\.


--
-- TOC entry 5639 (class 0 OID 0)
-- Dependencies: 239
-- Name: listings_registration_number_seq; Type: SEQUENCE SET; Schema: listing; Owner: postgres
--

SELECT pg_catalog.setval('listing.listings_registration_number_seq', 10001, false);


--
-- TOC entry 5371 (class 2606 OID 143330)
-- Name: countries countries_pk; Type: CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.countries
    ADD CONSTRAINT countries_pk PRIMARY KEY (id);


--
-- TOC entry 5375 (class 2606 OID 143353)
-- Name: districts districts_pk; Type: CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.districts
    ADD CONSTRAINT districts_pk PRIMARY KEY (id);


--
-- TOC entry 5373 (class 2606 OID 143339)
-- Name: states states_pk; Type: CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.states
    ADD CONSTRAINT states_pk PRIMARY KEY (id);


--
-- TOC entry 5377 (class 2606 OID 143367)
-- Name: talukas talukas_pk; Type: CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.talukas
    ADD CONSTRAINT talukas_pk PRIMARY KEY (id);


--
-- TOC entry 5260 (class 2606 OID 142442)
-- Name: admin_districts admin_districts_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.admin_districts
    ADD CONSTRAINT admin_districts_pk PRIMARY KEY (id);


--
-- TOC entry 5254 (class 2606 OID 142390)
-- Name: permissions permissions_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.permissions
    ADD CONSTRAINT permissions_pk PRIMARY KEY (id);


--
-- TOC entry 5256 (class 2606 OID 142416)
-- Name: profile profile_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.profile
    ADD CONSTRAINT profile_pk PRIMARY KEY (id);


--
-- TOC entry 5246 (class 2606 OID 142354)
-- Name: roles roles_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.roles
    ADD CONSTRAINT roles_pk PRIMARY KEY (id);


--
-- TOC entry 5379 (class 2606 OID 143382)
-- Name: user_division_assignments user_division_assignments_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.user_division_assignments
    ADD CONSTRAINT user_division_assignments_pk PRIMARY KEY (id);


--
-- TOC entry 5381 (class 2606 OID 143384)
-- Name: user_division_assignments user_division_assignments_user_unique; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.user_division_assignments
    ADD CONSTRAINT user_division_assignments_user_unique UNIQUE (user_id);


--
-- TOC entry 5258 (class 2606 OID 142429)
-- Name: user_listings_saves user_listings_saves_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.user_listings_saves
    ADD CONSTRAINT user_listings_saves_pk PRIMARY KEY (id);


--
-- TOC entry 5248 (class 2606 OID 142377)
-- Name: users users_email_key; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- TOC entry 5250 (class 2606 OID 142375)
-- Name: users users_mobile_key; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.users
    ADD CONSTRAINT users_mobile_key UNIQUE (mobile);


--
-- TOC entry 5252 (class 2606 OID 142373)
-- Name: users users_pk; Type: CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.users
    ADD CONSTRAINT users_pk PRIMARY KEY (id);


--
-- TOC entry 5312 (class 2606 OID 142668)
-- Name: accommodations_rooms_availability_dates accommodations_rooms_availability_dates_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_availability_dates
    ADD CONSTRAINT accommodations_rooms_availability_dates_pk PRIMARY KEY (id);


--
-- TOC entry 5315 (class 2606 OID 142681)
-- Name: accommodations_rooms_facilities accommodations_rooms_facilities_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_facilities
    ADD CONSTRAINT accommodations_rooms_facilities_pk PRIMARY KEY (id);


--
-- TOC entry 5317 (class 2606 OID 142702)
-- Name: accommodations_rooms_photos accommodations_rooms_photos_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_photos
    ADD CONSTRAINT accommodations_rooms_photos_pk PRIMARY KEY (id);


--
-- TOC entry 5309 (class 2606 OID 142657)
-- Name: accommodations_rooms accommodations_rooms_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms
    ADD CONSTRAINT accommodations_rooms_pk PRIMARY KEY (id);


--
-- TOC entry 5287 (class 2606 OID 142552)
-- Name: additional_service_fees additional_service_fees_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.additional_service_fees
    ADD CONSTRAINT additional_service_fees_pk PRIMARY KEY (id);


--
-- TOC entry 5364 (class 2606 OID 142934)
-- Name: available_dates aqua_tourism_available_dates_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.available_dates
    ADD CONSTRAINT aqua_tourism_available_dates_pk PRIMARY KEY (id);


--
-- TOC entry 5342 (class 2606 OID 142831)
-- Name: aqua_tourism_tour_dates aqua_tourism_tour_dates_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.aqua_tourism_tour_dates
    ADD CONSTRAINT aqua_tourism_tour_dates_pk PRIMARY KEY (id);


--
-- TOC entry 5339 (class 2606 OID 142820)
-- Name: aqua_tourism_tour_package aqua_tourism_tour_package_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.aqua_tourism_tour_package
    ADD CONSTRAINT aqua_tourism_tour_package_pk PRIMARY KEY (id);


--
-- TOC entry 5281 (class 2606 OID 142526)
-- Name: business_documents business_documents_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.business_documents
    ADD CONSTRAINT business_documents_pk PRIMARY KEY (id);


--
-- TOC entry 5262 (class 2606 OID 142459)
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- TOC entry 5264 (class 2606 OID 142457)
-- Name: categories categories_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.categories
    ADD CONSTRAINT categories_pk PRIMARY KEY (id);


--
-- TOC entry 5345 (class 2606 OID 142844)
-- Name: company_packages company_packages_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.company_packages
    ADD CONSTRAINT company_packages_pk PRIMARY KEY (id);


--
-- TOC entry 5293 (class 2606 OID 142578)
-- Name: contact_details contact_details_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.contact_details
    ADD CONSTRAINT contact_details_pk PRIMARY KEY (id);


--
-- TOC entry 5290 (class 2606 OID 142565)
-- Name: coupons coupons_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.coupons
    ADD CONSTRAINT coupons_pk PRIMARY KEY (id);


--
-- TOC entry 5331 (class 2606 OID 142773)
-- Name: cuisine_menu_photos cuisine_menu_photos_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.cuisine_menu_photos
    ADD CONSTRAINT cuisine_menu_photos_pk PRIMARY KEY (id);


--
-- TOC entry 5328 (class 2606 OID 142760)
-- Name: cuisine_menu cuisine_menu_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.cuisine_menu
    ADD CONSTRAINT cuisine_menu_pk PRIMARY KEY (id);


--
-- TOC entry 5322 (class 2606 OID 142736)
-- Name: event_experiences_tickets event_experiences_tickets_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.event_experiences_tickets
    ADD CONSTRAINT event_experiences_tickets_pk PRIMARY KEY (id);


--
-- TOC entry 5325 (class 2606 OID 142747)
-- Name: event_experiences_timeslots event_experiences_timeslots_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.event_experiences_timeslots
    ADD CONSTRAINT event_experiences_timeslots_pk PRIMARY KEY (id);


--
-- TOC entry 5357 (class 2606 OID 142894)
-- Name: events_festivals_performers events_festivals_performers_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_performers
    ADD CONSTRAINT events_festivals_performers_pk PRIMARY KEY (id);


--
-- TOC entry 5360 (class 2606 OID 142907)
-- Name: events_festivals_performers_social_urls events_festivals_performers_social_urls_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_performers_social_urls
    ADD CONSTRAINT events_festivals_performers_social_urls_pk PRIMARY KEY (id);


--
-- TOC entry 5354 (class 2606 OID 142881)
-- Name: events_festivals_pricing events_festivals_pricing_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_pricing
    ADD CONSTRAINT events_festivals_pricing_pk PRIMARY KEY (id);


--
-- TOC entry 5351 (class 2606 OID 142868)
-- Name: experiences_activities_slots_pricing experiences_activities_slots_pricing_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.experiences_activities_slots_pricing
    ADD CONSTRAINT experiences_activities_slots_pricing_pk PRIMARY KEY (id);


--
-- TOC entry 5300 (class 2606 OID 142596)
-- Name: facilities facilities_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.facilities
    ADD CONSTRAINT facilities_pk PRIMARY KEY (id);


--
-- TOC entry 5278 (class 2606 OID 142513)
-- Name: faqs faqs_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.faqs
    ADD CONSTRAINT faqs_pk PRIMARY KEY (id);


--
-- TOC entry 5348 (class 2606 OID 142857)
-- Name: guided_tours_tour_packages guided_tours_tour_packages_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.guided_tours_tour_packages
    ADD CONSTRAINT guided_tours_tour_packages_pk PRIMARY KEY (id);


--
-- TOC entry 5333 (class 2606 OID 142794)
-- Name: handicrafts_souvenirs_documents handicrafts_souvenirs_documents_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.handicrafts_souvenirs_documents
    ADD CONSTRAINT handicrafts_souvenirs_documents_pk PRIMARY KEY (id);


--
-- TOC entry 5336 (class 2606 OID 142807)
-- Name: handicrafts_souvenirs_tour_packages handicrafts_souvenirs_tour_packages_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.handicrafts_souvenirs_tour_packages
    ADD CONSTRAINT handicrafts_souvenirs_tour_packages_pk PRIMARY KEY (id);


--
-- TOC entry 5276 (class 2606 OID 142490)
-- Name: listings listings_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.listings
    ADD CONSTRAINT listings_pk PRIMARY KEY (id);


--
-- TOC entry 5367 (class 2606 OID 142978)
-- Name: search_analytics search_analytics_keyword_cat_uq; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.search_analytics
    ADD CONSTRAINT search_analytics_keyword_cat_uq UNIQUE (keyword, category);


--
-- TOC entry 5369 (class 2606 OID 142976)
-- Name: search_analytics search_analytics_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.search_analytics
    ADD CONSTRAINT search_analytics_pk PRIMARY KEY (id);


--
-- TOC entry 5285 (class 2606 OID 142539)
-- Name: social_urls social_urls_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.social_urls
    ADD CONSTRAINT social_urls_pk PRIMARY KEY (id);


--
-- TOC entry 5362 (class 2606 OID 142928)
-- Name: social_websites social_websites_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.social_websites
    ADD CONSTRAINT social_websites_pk PRIMARY KEY (id);


--
-- TOC entry 5266 (class 2606 OID 142467)
-- Name: sub_categories sub_categories_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.sub_categories
    ADD CONSTRAINT sub_categories_pk PRIMARY KEY (id);


--
-- TOC entry 5320 (class 2606 OID 142723)
-- Name: tour_packages tour_packages_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.tour_packages
    ADD CONSTRAINT tour_packages_pk PRIMARY KEY (id);


--
-- TOC entry 5304 (class 2606 OID 142633)
-- Name: working_hours working_hours_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.working_hours
    ADD CONSTRAINT working_hours_pk PRIMARY KEY (id);


--
-- TOC entry 5307 (class 2606 OID 142644)
-- Name: working_hours_specific working_hours_specific_pk; Type: CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.working_hours_specific
    ADD CONSTRAINT working_hours_specific_pk PRIMARY KEY (id);


--
-- TOC entry 5313 (class 1259 OID 142948)
-- Name: idx_accommodations_rooms_availability_dates_room_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_accommodations_rooms_availability_dates_room_id ON listing.accommodations_rooms_availability_dates USING btree (accommodations_rooms_id, date);


--
-- TOC entry 5310 (class 1259 OID 142947)
-- Name: idx_accommodations_rooms_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_accommodations_rooms_listing_id ON listing.accommodations_rooms USING btree (listing_id);


--
-- TOC entry 5288 (class 1259 OID 142943)
-- Name: idx_additional_service_fees_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_additional_service_fees_listing_id ON listing.additional_service_fees USING btree (listing_id);


--
-- TOC entry 5343 (class 1259 OID 142956)
-- Name: idx_aqua_tourism_tour_dates_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_aqua_tourism_tour_dates_listing_id ON listing.aqua_tourism_tour_dates USING btree (listing_id);


--
-- TOC entry 5340 (class 1259 OID 142955)
-- Name: idx_aqua_tourism_tour_package_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_aqua_tourism_tour_package_listing_id ON listing.aqua_tourism_tour_package USING btree (listing_id);


--
-- TOC entry 5365 (class 1259 OID 142962)
-- Name: idx_available_dates_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_available_dates_listing_id ON listing.available_dates USING btree (listing_id);


--
-- TOC entry 5282 (class 1259 OID 142941)
-- Name: idx_business_documents_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_business_documents_listing_id ON listing.business_documents USING btree (listing_id);


--
-- TOC entry 5346 (class 1259 OID 142957)
-- Name: idx_company_packages_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_company_packages_listing_id ON listing.company_packages USING btree (listing_id);


--
-- TOC entry 5294 (class 1259 OID 142586)
-- Name: idx_contact_details_city_name; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_contact_details_city_name ON listing.contact_details USING btree (city_name);


--
-- TOC entry 5295 (class 1259 OID 142587)
-- Name: idx_contact_details_city_name_trgm; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_contact_details_city_name_trgm ON listing.contact_details USING gin (city_name public.gin_trgm_ops);


--
-- TOC entry 5296 (class 1259 OID 142585)
-- Name: idx_contact_details_district_name; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_contact_details_district_name ON listing.contact_details USING btree (district_name);


--
-- TOC entry 5297 (class 1259 OID 142588)
-- Name: idx_contact_details_district_name_trgm; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_contact_details_district_name_trgm ON listing.contact_details USING gin (district_name public.gin_trgm_ops);


--
-- TOC entry 5298 (class 1259 OID 142584)
-- Name: idx_contact_details_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_contact_details_listing_id ON listing.contact_details USING btree (listing_id);


--
-- TOC entry 5291 (class 1259 OID 142944)
-- Name: idx_coupons_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_coupons_listing_id ON listing.coupons USING btree (listing_id);


--
-- TOC entry 5329 (class 1259 OID 142952)
-- Name: idx_cuisine_menu_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_cuisine_menu_listing_id ON listing.cuisine_menu USING btree (listing_id);


--
-- TOC entry 5323 (class 1259 OID 142950)
-- Name: idx_event_experiences_tickets_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_event_experiences_tickets_listing_id ON listing.event_experiences_tickets USING btree (listing_id);


--
-- TOC entry 5326 (class 1259 OID 142951)
-- Name: idx_event_experiences_timeslots_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_event_experiences_timeslots_listing_id ON listing.event_experiences_timeslots USING btree (listing_id);


--
-- TOC entry 5358 (class 1259 OID 142961)
-- Name: idx_events_festivals_performers_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_events_festivals_performers_listing_id ON listing.events_festivals_performers USING btree (listing_id);


--
-- TOC entry 5355 (class 1259 OID 142960)
-- Name: idx_events_festivals_pricing_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_events_festivals_pricing_listing_id ON listing.events_festivals_pricing USING btree (listing_id);


--
-- TOC entry 5352 (class 1259 OID 142959)
-- Name: idx_experiences_activities_slots_pricing_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_experiences_activities_slots_pricing_listing_id ON listing.experiences_activities_slots_pricing USING btree (listing_id);


--
-- TOC entry 5279 (class 1259 OID 142940)
-- Name: idx_faqs_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_faqs_listing_id ON listing.faqs USING btree (listing_id);


--
-- TOC entry 5349 (class 1259 OID 142958)
-- Name: idx_guided_tours_tour_packages_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_guided_tours_tour_packages_listing_id ON listing.guided_tours_tour_packages USING btree (listing_id);


--
-- TOC entry 5334 (class 1259 OID 142953)
-- Name: idx_handicrafts_souvenirs_documents_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_handicrafts_souvenirs_documents_listing_id ON listing.handicrafts_souvenirs_documents USING btree (listing_id);


--
-- TOC entry 5337 (class 1259 OID 142954)
-- Name: idx_handicrafts_souvenirs_tour_packages_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_handicrafts_souvenirs_tour_packages_listing_id ON listing.handicrafts_souvenirs_tour_packages USING btree (listing_id);


--
-- TOC entry 5267 (class 1259 OID 142498)
-- Name: idx_listings_approval_status; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_approval_status ON listing.listings USING btree (approval_status);


--
-- TOC entry 5268 (class 1259 OID 142500)
-- Name: idx_listings_category_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_category_id ON listing.listings USING btree (category_id);


--
-- TOC entry 5269 (class 1259 OID 142499)
-- Name: idx_listings_is_archived; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_is_archived ON listing.listings USING btree (is_archived);


--
-- TOC entry 5270 (class 1259 OID 142505)
-- Name: idx_listings_name_of_business_trgm; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_name_of_business_trgm ON listing.listings USING gin (name_of_business public.gin_trgm_ops);


--
-- TOC entry 5271 (class 1259 OID 142501)
-- Name: idx_listings_registration_number; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE UNIQUE INDEX idx_listings_registration_number ON listing.listings USING btree (registration_number);


--
-- TOC entry 5272 (class 1259 OID 142504)
-- Name: idx_listings_slug_normalized; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_slug_normalized ON listing.listings USING btree (TRIM(BOTH '-'::text FROM regexp_replace((slug)::text, '-+'::text, '-'::text, 'g'::text)));


--
-- TOC entry 5273 (class 1259 OID 142503)
-- Name: idx_listings_status_archived_category; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_status_archived_category ON listing.listings USING btree (approval_status, is_archived, category_id);


--
-- TOC entry 5274 (class 1259 OID 142502)
-- Name: idx_listings_user_id_created_at; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_listings_user_id_created_at ON listing.listings USING btree (user_id, created_at DESC, id DESC);


--
-- TOC entry 5301 (class 1259 OID 142625)
-- Name: idx_selected_facilities_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_selected_facilities_listing_id ON listing.selected_facilities USING btree (listing_id);


--
-- TOC entry 5283 (class 1259 OID 142942)
-- Name: idx_social_urls_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_social_urls_listing_id ON listing.social_urls USING btree (listing_id);


--
-- TOC entry 5318 (class 1259 OID 142949)
-- Name: idx_tour_packages_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_tour_packages_listing_id ON listing.tour_packages USING btree (listing_id);


--
-- TOC entry 5302 (class 1259 OID 142945)
-- Name: idx_working_hours_listing_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_working_hours_listing_id ON listing.working_hours USING btree (listing_id);


--
-- TOC entry 5305 (class 1259 OID 142946)
-- Name: idx_working_hours_specific_working_hours_id; Type: INDEX; Schema: listing; Owner: postgres
--

CREATE INDEX idx_working_hours_specific_working_hours_id ON listing.working_hours_specific USING btree (working_hours_id);


--
-- TOC entry 5427 (class 2606 OID 143354)
-- Name: districts districts_states_fk; Type: FK CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.districts
    ADD CONSTRAINT districts_states_fk FOREIGN KEY (state_id) REFERENCES geography.states(id);


--
-- TOC entry 5426 (class 2606 OID 143340)
-- Name: states states_countries_fk; Type: FK CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.states
    ADD CONSTRAINT states_countries_fk FOREIGN KEY (country_id) REFERENCES geography.countries(id);


--
-- TOC entry 5428 (class 2606 OID 143368)
-- Name: talukas talukas_districts_fk; Type: FK CONSTRAINT; Schema: geography; Owner: postgres
--

ALTER TABLE ONLY geography.talukas
    ADD CONSTRAINT talukas_districts_fk FOREIGN KEY (district_id) REFERENCES geography.districts(id);


--
-- TOC entry 5387 (class 2606 OID 142443)
-- Name: admin_districts admin_districts_users_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.admin_districts
    ADD CONSTRAINT admin_districts_users_fk FOREIGN KEY (user_id) REFERENCES identityaccess.users(id);


--
-- TOC entry 5385 (class 2606 OID 142417)
-- Name: profile profile_users_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.profile
    ADD CONSTRAINT profile_users_fk FOREIGN KEY (user_id) REFERENCES identityaccess.users(id);


--
-- TOC entry 5383 (class 2606 OID 142401)
-- Name: role_permissions role_permissions_permissions_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.role_permissions
    ADD CONSTRAINT role_permissions_permissions_fk FOREIGN KEY (permission_id) REFERENCES identityaccess.permissions(id);


--
-- TOC entry 5384 (class 2606 OID 142396)
-- Name: role_permissions role_permissions_roles_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.role_permissions
    ADD CONSTRAINT role_permissions_roles_fk FOREIGN KEY (role_id) REFERENCES identityaccess.roles(id);


--
-- TOC entry 5429 (class 2606 OID 143385)
-- Name: user_division_assignments user_division_assignments_users_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.user_division_assignments
    ADD CONSTRAINT user_division_assignments_users_fk FOREIGN KEY (user_id) REFERENCES identityaccess.users(id) ON DELETE CASCADE;


--
-- TOC entry 5386 (class 2606 OID 142430)
-- Name: user_listings_saves user_listings_saves_users_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.user_listings_saves
    ADD CONSTRAINT user_listings_saves_users_fk FOREIGN KEY (user_id) REFERENCES identityaccess.users(id);


--
-- TOC entry 5382 (class 2606 OID 142378)
-- Name: users users_roles_fk; Type: FK CONSTRAINT; Schema: identityaccess; Owner: postgres
--

ALTER TABLE ONLY identityaccess.users
    ADD CONSTRAINT users_roles_fk FOREIGN KEY (role_id) REFERENCES identityaccess.roles(id);


--
-- TOC entry 5403 (class 2606 OID 142669)
-- Name: accommodations_rooms_availability_dates accommodations_rooms_availability_dates_accommodations_rooms_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_availability_dates
    ADD CONSTRAINT accommodations_rooms_availability_dates_accommodations_rooms_fk FOREIGN KEY (accommodations_rooms_id) REFERENCES listing.accommodations_rooms(id);


--
-- TOC entry 5402 (class 2606 OID 142658)
-- Name: accommodations_rooms accommodations_rooms_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms
    ADD CONSTRAINT accommodations_rooms_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5393 (class 2606 OID 142553)
-- Name: additional_service_fees additional_service_fees_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.additional_service_fees
    ADD CONSTRAINT additional_service_fees_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5425 (class 2606 OID 142935)
-- Name: available_dates aqua_tourism_available_dates_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.available_dates
    ADD CONSTRAINT aqua_tourism_available_dates_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5417 (class 2606 OID 142832)
-- Name: aqua_tourism_tour_dates aqua_tourism_tour_dates_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.aqua_tourism_tour_dates
    ADD CONSTRAINT aqua_tourism_tour_dates_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5416 (class 2606 OID 142821)
-- Name: aqua_tourism_tour_package aqua_tourism_tour_package_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.aqua_tourism_tour_package
    ADD CONSTRAINT aqua_tourism_tour_package_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5391 (class 2606 OID 142527)
-- Name: business_documents business_documents_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.business_documents
    ADD CONSTRAINT business_documents_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5418 (class 2606 OID 142845)
-- Name: company_packages company_packages_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.company_packages
    ADD CONSTRAINT company_packages_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5395 (class 2606 OID 142579)
-- Name: contact_details contact_details_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.contact_details
    ADD CONSTRAINT contact_details_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5394 (class 2606 OID 142566)
-- Name: coupons coupons_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.coupons
    ADD CONSTRAINT coupons_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5411 (class 2606 OID 142761)
-- Name: cuisine_menu cuisine_menu_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.cuisine_menu
    ADD CONSTRAINT cuisine_menu_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5409 (class 2606 OID 142737)
-- Name: event_experiences_tickets event_experiences_tickets_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.event_experiences_tickets
    ADD CONSTRAINT event_experiences_tickets_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5410 (class 2606 OID 142748)
-- Name: event_experiences_timeslots event_experiences_timeslots_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.event_experiences_timeslots
    ADD CONSTRAINT event_experiences_timeslots_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5422 (class 2606 OID 142895)
-- Name: events_festivals_performers events_festivals_performers_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_performers
    ADD CONSTRAINT events_festivals_performers_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5421 (class 2606 OID 142882)
-- Name: events_festivals_pricing events_festivals_pricing_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_pricing
    ADD CONSTRAINT events_festivals_pricing_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5420 (class 2606 OID 142869)
-- Name: experiences_activities_slots_pricing experiences_activities_slots_pricing_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.experiences_activities_slots_pricing
    ADD CONSTRAINT experiences_activities_slots_pricing_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5390 (class 2606 OID 142514)
-- Name: faqs faqs_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.faqs
    ADD CONSTRAINT faqs_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5419 (class 2606 OID 142858)
-- Name: guided_tours_tour_packages guided_tours_tour_packages_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.guided_tours_tour_packages
    ADD CONSTRAINT guided_tours_tour_packages_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5414 (class 2606 OID 142795)
-- Name: handicrafts_souvenirs_documents handicrafts_souvenirs_documents_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.handicrafts_souvenirs_documents
    ADD CONSTRAINT handicrafts_souvenirs_documents_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5415 (class 2606 OID 142808)
-- Name: handicrafts_souvenirs_tour_packages handicrafts_souvenirs_tour_packages_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.handicrafts_souvenirs_tour_packages
    ADD CONSTRAINT handicrafts_souvenirs_tour_packages_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5396 (class 2606 OID 142600)
-- Name: listing_facility listing_facility_categories_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.listing_facility
    ADD CONSTRAINT listing_facility_categories_fk FOREIGN KEY (category_id) REFERENCES listing.categories(id);


--
-- TOC entry 5397 (class 2606 OID 142605)
-- Name: listing_facility listing_facility_facilities_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.listing_facility
    ADD CONSTRAINT listing_facility_facilities_fk FOREIGN KEY (facility_id) REFERENCES listing.facilities(id);


--
-- TOC entry 5389 (class 2606 OID 142491)
-- Name: listings listings_categories_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.listings
    ADD CONSTRAINT listings_categories_fk FOREIGN KEY (category_id) REFERENCES listing.categories(id);


--
-- TOC entry 5398 (class 2606 OID 142620)
-- Name: selected_facilities selected_facilities_facility_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.selected_facilities
    ADD CONSTRAINT selected_facilities_facility_fk FOREIGN KEY (facility_id) REFERENCES listing.facilities(id);


--
-- TOC entry 5399 (class 2606 OID 142615)
-- Name: selected_facilities selected_facilities_listing_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.selected_facilities
    ADD CONSTRAINT selected_facilities_listing_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5392 (class 2606 OID 142540)
-- Name: social_urls social_urls_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.social_urls
    ADD CONSTRAINT social_urls_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5388 (class 2606 OID 142468)
-- Name: sub_categories sub_categories_categories_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.sub_categories
    ADD CONSTRAINT sub_categories_categories_fk FOREIGN KEY (category_id) REFERENCES listing.categories(id);


--
-- TOC entry 5404 (class 2606 OID 142690)
-- Name: accommodations_rooms_accommodations_rooms_facilities this_accommodations_rooms_facility_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_accommodations_rooms_facilities
    ADD CONSTRAINT this_accommodations_rooms_facility_fk FOREIGN KEY (accommodations_rooms_facility_id) REFERENCES listing.accommodations_rooms_facilities(id);


--
-- TOC entry 5405 (class 2606 OID 142685)
-- Name: accommodations_rooms_accommodations_rooms_facilities this_accommodations_rooms_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_accommodations_rooms_facilities
    ADD CONSTRAINT this_accommodations_rooms_fk FOREIGN KEY (accommodations_rooms_id) REFERENCES listing.accommodations_rooms(id);


--
-- TOC entry 5406 (class 2606 OID 142706)
-- Name: accommodations_rooms_accommodations_rooms_photos this_accommodations_rooms_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_accommodations_rooms_photos
    ADD CONSTRAINT this_accommodations_rooms_fk FOREIGN KEY (accommodations_rooms_id) REFERENCES listing.accommodations_rooms(id);


--
-- TOC entry 5407 (class 2606 OID 142711)
-- Name: accommodations_rooms_accommodations_rooms_photos this_accommodations_rooms_photos_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.accommodations_rooms_accommodations_rooms_photos
    ADD CONSTRAINT this_accommodations_rooms_photos_fk FOREIGN KEY (accommodations_rooms_photos_id) REFERENCES listing.accommodations_rooms_photos(id);


--
-- TOC entry 5412 (class 2606 OID 142777)
-- Name: cuisine_menu_cuisine_menu_photos this_cuisine_menu_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.cuisine_menu_cuisine_menu_photos
    ADD CONSTRAINT this_cuisine_menu_fk FOREIGN KEY (cuisine_menu_id) REFERENCES listing.cuisine_menu(id);


--
-- TOC entry 5413 (class 2606 OID 142782)
-- Name: cuisine_menu_cuisine_menu_photos this_cuisine_menu_photos_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.cuisine_menu_cuisine_menu_photos
    ADD CONSTRAINT this_cuisine_menu_photos_fk FOREIGN KEY (cuisine_menu_photos_id) REFERENCES listing.cuisine_menu_photos(id);


--
-- TOC entry 5423 (class 2606 OID 142911)
-- Name: events_festivals_performers_urls this_events_festivals_performers_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_performers_urls
    ADD CONSTRAINT this_events_festivals_performers_fk FOREIGN KEY (events_festivals_performers) REFERENCES listing.events_festivals_performers(id);


--
-- TOC entry 5424 (class 2606 OID 142916)
-- Name: events_festivals_performers_urls this_events_festivals_performers_social_url_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.events_festivals_performers_urls
    ADD CONSTRAINT this_events_festivals_performers_social_url_fk FOREIGN KEY (events_festivals_performers_social_urls_id) REFERENCES listing.events_festivals_performers_social_urls(id);


--
-- TOC entry 5408 (class 2606 OID 142724)
-- Name: tour_packages tour_packages_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.tour_packages
    ADD CONSTRAINT tour_packages_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5400 (class 2606 OID 142634)
-- Name: working_hours working_hours_listings_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.working_hours
    ADD CONSTRAINT working_hours_listings_fk FOREIGN KEY (listing_id) REFERENCES listing.listings(id);


--
-- TOC entry 5401 (class 2606 OID 142645)
-- Name: working_hours_specific working_hours_specific_working_hours_fk; Type: FK CONSTRAINT; Schema: listing; Owner: postgres
--

ALTER TABLE ONLY listing.working_hours_specific
    ADD CONSTRAINT working_hours_specific_working_hours_fk FOREIGN KEY (working_hours_id) REFERENCES listing.working_hours(id);


--
-- TOC entry 5631 (class 0 OID 143496)
-- Dependencies: 313 5633
-- Name: mv_user_roles; Type: MATERIALIZED VIEW DATA; Schema: identityaccess; Owner: postgres
--

REFRESH MATERIALIZED VIEW identityaccess.mv_user_roles;


-- Completed on 2026-08-11 14:25:04

--
-- PostgreSQL database dump complete
--

\unrestrict x5stHJhaoKgGdRXEnC6b58WoTehCOixtRKg3hY1G0u9FD5doaF01NfRYBdafEbb

