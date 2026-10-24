---
status: accepted
---

# FastAPI is the Supabase client

Supabase Auth stores Member credentials and issues sessions. The app's only API is FastAPI, which performs that sign-in and every other business action. Postgres and Storage stay in Supabase, and FastAPI is their only writer, except that the phone loads a public photo URL itself.

## Considered options

- Passwords and tokens inside FastAPI. This is what the boilerplate does. Supabase Auth is the credential store instead.
- The app calling Supabase for sign-in, rows, and uploads. Business rules stay in FastAPI. Edge Functions stay unused.
- Confirmation mail before a session. Signup signs the Member in immediately. The @bu.edu rule is the address they registered. Whoever can open that inbox can reset the password and continue as the same Member.

## Consequences

- Alembic is the only migration history. It creates the tables, the Member insert trigger, the rejection of a later email change, row-level security with no anon or authenticated access, and the public bucket.
- A photo upload is JPEG, PNG, or HEIC, at most 10 MB. FastAPI deletes the object if the Report row does not commit. The picture stays after the Hazard is resolved, and anyone with the URL can view it.
- Deleting the auth user is refused while the Member row exists.
