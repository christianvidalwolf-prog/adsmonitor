# Amazon Validation Rules

This file documents the business and logical validation rules required for Amazon inventory, price, and quantity feeds.

## 1. SKU & ASIN Requirements
- **Presence**: All listings must have a non-empty, unique Seller SKU (Merchant SKU) or ASIN.
- **Uniqueness**: In the final output sheet, each SKU must appear exactly once. Duplicate SKU rows will cause processing conflicts on Amazon.

## 2. Fulfillment Channel Code (`fulfillment_channel_code`)
- **Rule**: Every listing in the upload file must explicitly state its fulfillment channel if quantities are updated.
- **FBM (Seller Fulfilled)**: Set to `DEFAULT` (internal technical value for "Logística por parte del vendedor"). Leaving it empty for updated rows triggers validation errors.
- **FBA (Amazon Fulfilled)**: Typically managed by Amazon; FBA items should not have their quantity updated manually (set to empty or omit FBA rows from price/quantity updates to avoid converting them to FBM).

## 3. Pricing Rules
- **Standard Price (`our_price`)**: Must be a positive decimal number.
- **Sale Price (`discounted_price`)**: Must be a positive decimal number, and it **cannot be greater than** the Standard Price.
- **Pricing Boundaries**:
  - `minimum_seller_allowed_price` (Min Price) should be lower than or equal to the Standard Price (often set to `Standard Price / 2`).
  - `maximum_seller_allowed_price` (Max Price) should be greater than or equal to the Standard Price (often set to `Standard Price * 2`).

## 4. Date and Schedule Rules
- **Date Format**: Dates must be written in `YYYY-MM-DD` format (e.g. `2026-07-02`).
- **Logical Sequence**: The promotion start date must be **earlier than or equal to** the end date.
- **Sale Schedule Columns**:
  - If a sale price is defined in `discounted_price...value_with_tax`, you **MUST** provide the sale schedule start and end dates in the schedule-specific columns:
    - `discounted_price#1.schedule#1.start_at` (Col L / Col 11)
    - `discounted_price#1.schedule#1.end_at` (Col K / Col 10)
  - Setting only the general offer dates (`start_at.value` and `end_at.value`) while leaving the sale schedule dates empty will result in rejection.
