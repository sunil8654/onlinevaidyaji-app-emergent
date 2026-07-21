#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Build "Online Vaidhyaji", an AYUSH health app. This iteration adds
  Doctor Dashboard enhancements: earnings summary, patient history, and a
  structured multi-medicine prescription writer with PDF export.

backend:
  - task: "Doctor earnings summary — GET /api/doctor/earnings"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "12/12 pytest in test_iter16_doctor_dashboard.py pass. Auth-gated, returns dense 30-day daily trend, zero-fills for fresh doctors, aggregates from payments table."

  - task: "Doctor patient history — GET /api/doctor/patients/{id}/history"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Returns 403 without prior treatment relationship, full payload after booking."

  - task: "Structured prescription (medicines_structured + auto-composed medicines)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 1
    priority: "high"
    needs_retesting: false
    status_history:
      - working: false
        agent: "testing"
        comment: "Initial run flagged CRITICAL — doctor auth check on /api/appointments/{id}/prescription compared users.id to appt.doctor_id (which is doctors.id)."
      - working: true
        agent: "main"
        comment: "Added _appt_actor_ids/_is_appt_participant helpers and applied fix to add_prescription, list_appointments (GET /api/appointments), and video/session ACL. All 12 iter16 tests + 140 non-deprecated regressions pass."

frontend:
  - task: "Doctor earnings dashboard screen"
    implemented: true
    working: true
    file: "/app/frontend/app/doctor/earnings.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Renders totals, period cards, 30-day bar chart, recent payouts. Empty state clean for fresh doctor. testIDs earn-back, earn-total, earn-today, earn-week, earn-month verified."

  - task: "Patient history screen for doctor"
    implemented: true
    working: true
    file: "/app/frontend/app/doctor/patient/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Renders profile card, stats, condition chips, and per-visit prescriptions. Friendly error box on 403 (no treatment history)."

  - task: "Structured prescription editor + PDF export"
    implemented: true
    working: true
    file: "/app/frontend/app/doctor/prescription/[apptId].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Multi-row medicines with add/remove, diagnosis/symptoms/advice/notes/follow-up, PDF export via expo-print on native and window.print on web. Save button disabled until diagnosis + ≥1 medicine name are set."

  - task: "Doctor home refactor — earnings tile + navigation, removed inline Rx modal"
    implemented: true
    working: true
    file: "/app/frontend/app/doctor/home.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Hero + stats + new earnings quick-tile + patient list navigation. Write Rx now opens the new full-screen editor."

metadata:
  created_by: "main_agent"

  - task: "Prakriti (Vata/Pitta/Kapha) constitution assessment — POST /api/prakriti/assess"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "9/9 iter17 tests pass. 400 for <5 answers, correct dosha maths (pure + dual constitution within 10pts), upserts patient_profiles.dosha for patient role only, no persistence for doctor role."

  - task: "Structured multi-day meal plan — POST /api/diet-plan (JSON output)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "duration_days (1/3/7) with clamping, structured=true → Claude Sonnet 4.5 returns valid JSON parsed into plan_structured (3 days × 7 slots verified). Auto-fills dosha from patient profile when not passed. Legacy body still works (text plan, plan_structured=null)."

frontend_task_c:
  - task: "Prakriti quiz screen"
    implemented: true
    working: true
    file: "/app/frontend/app/prakriti-quiz.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "12 questions with progress bar, auto-advance on pick, auto-submit on completion, results screen with dosha hero, score bars, traits, balance. CTAs wire to diet-plan and retake."
      - working: true
        agent: "main"
        comment: "Replaced useMemo with useEffect for auto-submit (semantic correctness)."

  - task: "Diet plan screen — structured plan renderer + dosha auto-fill + duration selector"
    implemented: true
    working: true
    file: "/app/frontend/app/diet-plan.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Loads saved dosha, shows Prakriti badge or 'Discover your Prakriti' banner. Duration selector (1/3/7), structured toggle, day tabs for multi-day plans, meal cards with slot/title/items/reasoning, favour/avoid boxes. Legacy text plans still render."

  - task: "Prakriti entry points — home tile + profile CTA"
    implemented: true
    working: true
    file: "/app/frontend/app/(tabs)/home.tsx, /app/frontend/app/(tabs)/profile.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "home-prakriti tile (row 2 of engagement grid, replacing 'Near You') and profile-prakriti CTA (on dosha card) both navigate to /prakriti-quiz."

agent_communication_task_c:
  - agent: "main"
    message: "Task C (Personalized Diet Plans) complete. Added /api/prakriti/assess (12-question quiz math with dominant + dual dosha), enhanced /api/diet-plan with structured JSON multi-day output via Claude Sonnet 4.5. New /prakriti-quiz screen and fully rewritten /diet-plan screen with day tabs, meal cards, favour/avoid, and Prakriti-aware banners. All 9 iter17 tests + full frontend flow verified. Only Task B (AI Yoga) remaining."

  version: "1.1"
  test_sequence: 16
  run_ui: false

test_plan:
  current_focus:
    - "Diet Plans (Task C) — Prakriti quiz + AI meal plan"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: "Task A (Doctor Dashboard) complete. Added backend endpoints for earnings + patient history, enhanced PrescriptionInput with structured medicines, symptoms, advice, follow_up. Frontend now has /doctor/earnings, /doctor/patient/[id], /doctor/prescription/[apptId] with PDF export (expo-print/expo-sharing). Fixed pre-existing doctor auth bug across /appointments listing, prescription, and video session — now resolves doctors.id from users row. Testing agent verified all 12 iter16 tests + regression suite. Next task per user preference: Personalized Diet Plans (Task C)."
