# DIGIPIN Integration for MahaAthithi

## Overview

Integrate the official **India Post DIGIPIN** system into the MahaAthithi project. DIGIPIN is an open-source National Geospatial Addressing Grid that converts latitude and longitude into a unique 10-character alphanumeric code and vice versa.

The integration **must use the official DIGIPIN algorithm** from the India Post GitHub repository. Do **not** reimplement or modify the algorithm except for TypeScript compatibility if required.

---

# Goals

- Integrate the official DIGIPIN algorithm directly into the existing backend.
- Automatically generate DIGIPIN for every location.
- Allow encoding and decoding through REST APIs.
- Store DIGIPIN alongside latitude and longitude.
- Display DIGIPIN throughout the application.
- Support searching by DIGIPIN.
- Maintain complete backward compatibility.

---

# Project Stack

## Backend

- Node.js
- Express
- TypeScript
- Prisma

## Frontend

- React
- Vite
- TypeScript

---

# Important Rules

## DO

- Use the official India Post implementation.
- Keep everything offline.
- Generate DIGIPIN locally.
- Follow existing project architecture.
- Maintain existing coding conventions.
- Reuse services where possible.
- Keep the implementation modular.
- Write production-quality code.
- Add proper validation.
- Add tests.

## DO NOT

- Do not create another Express application.
- Do not deploy the DIGIPIN repository separately.
- Do not call external APIs.
- Do not rewrite the DIGIPIN algorithm.
- Do not introduce breaking changes.
- Do not remove latitude or longitude fields.
- Do not allow manual editing of DIGIPIN.

---

# Implementation Tasks

## 1. Add DIGIPIN Utility

Create

```
src/utils/digipin.ts
```

Move the official DIGIPIN implementation into this file.

Export

```ts
getDigiPin(latitude, longitude)

getLatLngFromDigiPin(digipin)
```

The implementation should remain identical to the official algorithm except for TypeScript conversion if necessary.

---

## 2. Create DIGIPIN Module

Create

```
src/modules/digipin/
```

Containing

```
digipin.service.ts

digipin.controller.ts

digipin.routes.ts
```

---

## 3. REST APIs

### Encode

```
POST /api/digipin/encode
```

Request

```json
{
    "latitude": 11.9139,
    "longitude": 79.8145
}
```

Response

```json
{
    "digipin": "XXXXXXXXXX"
}
```

---

### Decode

```
POST /api/digipin/decode
```

Request

```json
{
    "digipin": "XXXXXXXXXX"
}
```

Response

```json
{
    "latitude": 11.9139,
    "longitude": 79.8145
}
```

---

## 4. Validation

Validate

- Latitude
- Longitude
- DIGIPIN format

Return appropriate status codes

- 200
- 400
- 404
- 500

Use the project's existing validation style.

---

# Database Integration

Locate every entity representing a physical location.

Examples include

- Tourist Places
- Temples
- Churches
- Mosques
- Museums
- Hospitals
- Hotels
- Restaurants
- Beaches
- Parks
- Parking
- Bus Stops
- Public Toilets
- Tourist Offices
- Event Venues
- Heritage Sites
- Any future location entity

---

## Prisma Migration

If the table does not already contain a DIGIPIN field, create one.

```prisma
digipin String?
```

Do **not** remove

- latitude
- longitude

Each location should store

- latitude
- longitude
- digipin

---

# Automatic DIGIPIN Generation

Whenever a location is

- Created
- Updated
- Imported
- Seeded

Automatically generate

```
DIGIPIN
```

using

```
Latitude
Longitude
```

before saving.

Users should never manually enter a DIGIPIN.

---

# Import Scripts

Update every

- Excel Import
- CSV Import
- Seeder

Flow

```
Latitude

Longitude

↓

Generate DIGIPIN

↓

Save
```

Every imported record must automatically receive a DIGIPIN.

---

# Admin Panel

Update every Create/Edit Location page.

Whenever latitude or longitude changes

```
Latitude

Longitude

↓

Generate DIGIPIN

↓

Readonly DIGIPIN Field
```

Features

- Auto generation
- Readonly field
- Copy button
- Validation
- No manual editing

---

# Public Website

Every location details page should display

- Address
- Latitude
- Longitude
- DIGIPIN

Provide

- Copy DIGIPIN
- Share DIGIPIN
- Open in Google Maps

---

# Search

Allow searching using

- Location Name
- DIGIPIN

Searching by a DIGIPIN should directly open the matching location.

---

# API Responses

Every API returning location information should include

```json
{
    "id": 1,
    "name": "Paradise Beach",
    "latitude": 11.9139,
    "longitude": 79.8145,
    "digipin": "XXXXXXXXXX"
}
```

---

# Swagger Documentation

Update the OpenAPI documentation.

Include

- Encode endpoint
- Decode endpoint
- DIGIPIN field
- Example requests
- Example responses
- Validation rules

---

# Testing

Create automated tests covering

## Encoding

- Valid coordinates
- Boundary values

## Decoding

- Valid DIGIPIN
- Invalid DIGIPIN

## Validation

- Invalid latitude
- Invalid longitude
- Empty values
- Out-of-range coordinates
- Malformed DIGIPIN

---

# Performance

The DIGIPIN algorithm executes locally.

Requirements

- No external API calls
- No HTTP requests
- No third-party services
- No internet dependency

Generation should be nearly instantaneous.

---

# Code Quality

- Follow existing folder structure.
- Keep controllers lightweight.
- Place business logic inside services.
- Avoid duplicate code.
- Maintain strict TypeScript typing.
- Reuse existing utilities.
- Keep the implementation modular.
- Follow project linting and formatting rules.

---

# Backward Compatibility

The integration must not break any existing functionality.

Existing APIs should continue to function exactly as before.

Latitude and longitude remain the primary stored coordinates.

DIGIPIN is an additional official geospatial identifier.

---

# Deliverables

After implementation, provide a summary containing

## Files Created

List every newly created file.

## Files Modified

List every modified file.

## Database Changes

Explain all Prisma schema changes and migrations.

## API Endpoints

List all new endpoints.

## Admin Changes

Summarize all UI updates.

## Public Website Changes

Summarize user-facing improvements.

## Import Changes

Explain changes to Excel/CSV import workflows.

## Tests

List all tests added.

## Manual Steps

Document any remaining manual setup required.

---

# Acceptance Criteria

- Official India Post DIGIPIN algorithm integrated.
- Offline generation only.
- Automatic DIGIPIN generation for every location.
- Full Prisma integration.
- REST API support.
- Search by DIGIPIN.
- Admin UI updated.
- Public UI updated.
- Swagger documentation updated.
- Unit tests added.
- No breaking changes.
- Production-ready implementation.
- Clean, maintainable, and fully typed code.