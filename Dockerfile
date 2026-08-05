# Docker-runtime deploy for pulse-crm-web and pulse-app-web (see
# render.yaml). Exists for one reason: PDF report export shells out to a
# `soffice` (LibreOffice) binary that Render's native Node runtime has no
# way to install (that buildpack's build step has no apt/root access) --
# see reportGeneration.js's convertDocxToPdf. Everything else this image
# does mirrors build.sh/render.yaml's previous native-runtime behaviour;
# do not let the two drift apart silently if one is edited without the
# other.
#
# BRAND-02 (read before touching the frontend build stage): pulse-crm-web
# and pulse-app-web must each get their OWN frontend build --
# VITE_APP_SURFACE picks between App.jsx (full CRM bundle) and
# AppRhythmEngine.jsx (pulse-only bundle, see that file's own header
# comment for why a licensee's branded Rhythm Engine domain must never
# receive so much as one CRM-only chunk). The two ARGs below are how each
# service's own environment variable reaches this build stage -- Render
# auto-populates a Docker build ARG from a same-named service env var, so
# render.yaml does not need any Docker-specific wiring beyond declaring
# them here. If you change this build, rebuild BOTH services and confirm
# via the network tab / frontend/src/AppRhythmEngine.test.js's own
# reasoning that pulse-app-web's served bundle contains no CRM-only chunk
# before considering the migration complete -- this is a security
# boundary, not a cosmetic one.
#
# Migrations and seeding intentionally do NOT run as a Docker build step.
# Render's Docker build environment may not have private-network access to
# the database (unlike the native buildpack's build phase, which clearly
# does, since build.sh ran them there) -- baking `npm run migrate` into a
# RUN instruction risks failing every build if that network path isn't
# open. They run at container start instead (this file's CMD), which is
# also just the more standard pattern for a containerised deploy. Both are
# already idempotent (schema_migrations + advisory lock; seed no-ops once
# an admin exists) so running them on every restart, on every service, is
# safe -- see migrations/run.js and seeds/run.js.

# ---- frontend build -------------------------------------------------------
FROM node:20-bookworm-slim AS frontend-build
ARG VITE_APP_SURFACE=crm
ARG VITE_CRM_APP_URL
ARG VITE_PULSE_APP_URL
ENV VITE_APP_SURFACE=${VITE_APP_SURFACE} \
    VITE_CRM_APP_URL=${VITE_CRM_APP_URL} \
    VITE_PULSE_APP_URL=${VITE_PULSE_APP_URL}
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm install --include=dev
COPY frontend/ ./
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime
ARG APP_SURFACE=crm
ENV APP_SURFACE=${APP_SURFACE} \
    NODE_ENV=production

# libreoffice-writer (not the full `libreoffice` metapackage) is the
# smallest apt package that provides headless DOCX->PDF conversion via
# `soffice --headless --convert-to pdf`. --no-install-recommends keeps this
# from pulling in the full desktop suite (Impress, Calc, GUI toolkits,
# etc.) that this app never uses.
#
# Known limitation, not fixed here: reportDocxBuilder.js sets the report's
# font to Poppins (a Google Font), which this image does not install.
# LibreOffice will substitute a fallback font for PDF conversion, so a
# downloaded PDF's typography will not exactly match the .docx. Purely a
# branding/fidelity gap, not a functional one -- the conversion itself
# still succeeds.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice-writer fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm install --omit=dev

COPY backend/ ./backend/
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 3001
CMD ["sh", "-c", "cd backend && npm run migrate && npm run seed && npm start"]
