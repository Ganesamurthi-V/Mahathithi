# Mahaatithi — "Submit New Listing" Form
## Field Requirements & Business Rules

---

## Step 1 – Category & Type

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Business Category | **Yes** | Dropdown | See options below |
| Sub Category | **Yes** | Multi-select (max 3) | Options change based on selected Business Category |

### Business Category Options

- Accommodations
- Aqua Tourism
- Cuisine
- Events and Festivals
- Experiences and Activities
- Experiences and Activities Slots
- Guided Tours
- Handicrafts and Souvenirs
- Tour Guide
- Tour Operator / Travel Agent / DMC

### Sub Category Options (by Business Category)

| **Business Category** | **Subcategories** |
|---|---|
| Accommodations | Hotel, Resort, Homestay, Guest House, Hostel |
| Aqua Tourism | Scuba Diving, Snorkeling, Boat Cruise, Kayaking, Jet Ski / Water Sports |
| Cuisine | Restaurant, Café, Street Food, Traditional Cuisine, Bakery & Sweets |
| Events and Festivals | Cultural Festival, Religious Festival, Music & Dance Event, Food Festival, Seasonal Celebration |
| Experiences and Activities | Adventure Activities, Cultural Experience, Wellness & Yoga, Nature Experience, Photography Experience |
| Experiences and Activities Slots | Morning Slot, Afternoon Slot, Evening Slot, Full Day Experience, Multi-Day Experience |
| Guided Tours | City Tour, Heritage Tour, Nature Tour, Food Tour, Walking Tour |
| Handicrafts and Souvenirs | Handmade Crafts, Textiles & Apparel, Jewelry & Accessories, Home Décor, Local Souvenirs |
| Tour Guide | Heritage Guide, Nature Guide, Adventure Guide, City Guide, Multilingual Guide |
| Tour Operator / Travel Agent / DMC | Local Tour Operator, Domestic Travel Agency, International Travel Agency, Destination Management Company (DMC), Custom Tour Planner |

---

## Step 2 – Basic Information

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Name of Your Business | **Yes** | Text | |
| Owner / Proprietor / Director Name | **Yes** | Text | |
| Country | **Yes** | Dropdown | Fixed to India |
| State | **Yes** | Dropdown | Fixed to Maharashtra |
| District | **Yes** | Dropdown | Sourced from `backend/data/maharashtra_districts.json` |
| City | **Yes** | Text | |
| Taluka | No | Dropdown | Disabled until District is selected; sourced from `backend/data/maharashtra_talukas.json`, filtered by selected district |
| Village | No | Text | |
| Pin / Zip Code | **Yes** | Text | |
| Business Address | **Yes** | Textarea | |
| Working Address | No | Textarea | "Same as Business Address" checkbox auto-fills |
| Latitude | **Yes** | Text / Map marker | Set by dragging marker on embedded map |
| Longitude | **Yes** | Text / Map marker | Set by dragging marker on embedded map |
| No. of Male Employees | No | Number | |
| No. of Female Employees | No | Number | |
| Mobile Number | **Yes** | Tel + country code | Default +91 |
| Landline | No | Tel + STD code | Dropdown of Maharashtra district STD codes |
| Alternate Mobile | No | Tel + country code | |
| Email Address | **Yes** | Email | |
| Alternate Email | No | Email | |
| Website | No | URL | |
| Aadhar Number | **Yes** | Text (12-digit numeric) | |
| Udyam Aadhar Reg. No. | **Yes** | Text | |
| GST Number | No | Text (15-char) | ⚠️ See Business Rule below — **not unique per user, but unique per listing** |
| FSSAI Number | No | Text | Relevant for Cuisine / food-related categories |

---

## Step 3 – Images & Media

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Display Image | **Yes** | File upload (image) | Must be square, e.g. 640×640 |
| Header Slider | **Yes** | File upload (multi-image) | Minimum 3 images, landscape orientation |

---

## Step 4 – Details

> ⚠️ **Accommodation Facilities and Accommodation Policies fields are shown only when `Accommodations` is selected as the Business Category.**

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Description | **Yes** | Rich text | Minimum 50 characters |
| Accommodation Facilities | **Yes** (Accommodations only) | Checkbox group | Amenities list (Pet Friendly, Wi-Fi, Pool, Spa, etc.) |
| Accommodation Policies | **Yes** (Accommodations only) | Rich text | Check-in/out, cancellation, refund, conduct, payment rules |
| Working Hours | **Yes** | Day selector + toggle | Per day: Open all day / Close all day / Enter specific hours |
| FAQ | No | Repeatable Q&A | Optional, add-as-needed |

---

## Step 5 – Rooms & Pricing

> ⚠️ **This entire step is shown only when `Accommodations` is selected as the Business Category.**

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Accommodation Room(s) | **Yes** | Repeatable form | At least one room must be added |
| Coupon Codes | No | Repeatable | |
| Sale Off | No | Percentage (0–100) | Shown as a discount badge on the listing |
| Additional Service Fees | No | Repeatable | |
| Booking Note | No | Rich text | Extra notes shown to guests at booking |

---

## Step 6 – Your Socials

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Social Links | No | Repeatable | Add social media profile links |

### Supported Platforms

- Facebook
- Instagram
- X (Twitter)
- YouTube
- LinkedIn
- Website
- WhatsApp
- Other

---

## Step 7 – Business Documents

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| About Business | **Yes** | Textarea | History, achievements, brief profile |
| Registered for "Travel for Life"? | No (defaults to "No") | Radio (Yes/No) | |
| Registered for Green Leaf Rating? | No (defaults to "No") | Radio (Yes/No) | |
| Received a Tourism Sector Award? | No (defaults to "No") | Radio (Yes/No) | |
| Udyog Aadhar Card Document | **Yes** | File upload (pdf/jpg/jpeg/png) | |
| Aadhar Card Document | **Yes** | File upload (pdf/jpg/jpeg/png) | |
| PAN Card Document | **Yes** | File upload (pdf/jpg/jpeg/png) | |
| Cancelled Cheque Document | **Yes** | File upload (pdf/jpg/jpeg/png) | |
| Custom Document (Name + File) | No | Repeatable pair | Add-as-needed, e.g. Trade License |

---

## Step 8 – Terms & Conditions

| **Field** | **Required** | **Type** | **Notes** |
|---|---|---|---|
| Agree to Terms & Conditions | **Yes** | Checkbox | |
| Declare information true & correct | **Yes** | Checkbox | |
| Acknowledge DOT is not liable for financial losses | **Yes** | Checkbox | Risk/expense responsibility sits with the vendor |

> On submit, the listing status is set to **Pending** and only goes live after Admin review and approval.

---

## Summary — Mandatory Fields Count

| **Step** | **Section** | **Required fields** |
|---|---|---|
| Step 1 | Category & Type | 2 of 2 |
| Step 2 | Basic Information | 15 of 24 |
| Step 3 | Images & Media | 2 of 2 |
| Step 4 | Details | 4 of 5 (2 are Accommodations-only) |
| Step 5 | Rooms & Pricing | 1 of 5 (Accommodations only) |
| Step 6 | Your Socials | 0 of 1 |
| Step 7 | Business Documents | 5 of 9 |
| Step 8 | Terms & Conditions | 3 of 3 |
| | **Total** | **32 required fields** |

---

## Business Rule — GST Number Uniqueness

> **A user may create multiple property listings on the MahaAtithi booking portal using the same Aadhaar Number. However, each listing must be associated with a unique GST Number. The system shall not allow the same GST Number to be used for more than one listing, even if the listings belong to the same user.**