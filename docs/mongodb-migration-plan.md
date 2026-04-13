---
description: mongodb migration plan for kazakh learn backend
---

# MongoDB Migration Plan

## What you need to do first

1. Install MongoDB
   - Local option: install MongoDB Community Server and MongoDB Compass
   - Cloud option: create a MongoDB Atlas cluster

2. Add a connection string to backend env
   - Add `MONGODB_URI=mongodb://127.0.0.1:27017/kazakh_learn`
   - Or use your Atlas URI

3. Install backend dependency when migration implementation starts
   - `npm install mongoose`

4. Current runtime status
   - The backend runtime is MongoDB-only
   - PostgreSQL code paths and setup scripts have been removed from normal local development

## Why MongoDB changes the backend design

### PostgreSQL now
- Normalized relational tables
- Foreign keys between `levels -> modules -> units -> lessons -> exercises`
- User progress split across separate tables
- JSONB already used for `path_points`, `landmark_position`

### MongoDB target
- Nested documents are natural for content trees
- No joins by default, so content should be grouped by access pattern
- User progress should be embedded where it is read together or placed in separate collections where it grows independently
- Application-level validation becomes more important than SQL constraints

## Recommended MongoDB collections

### 1. `users`
Store auth and profile data.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "email": "test@test.com",
  "passwordHash": "...",
  "name": "Test",
  "avatarUrl": null,
  "xp": 0,
  "streak": 1,
  "lastActivity": "2026-03-18",
  "isAdmin": false,
  "createdAt": "..."
}
```

Indexes:
- unique `email`
- optional `isAdmin`
- optional `xp` for rating queries

### 2. `levels`
Store CEFR levels and module references or embedded lightweight module metadata.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "code": "A1",
  "name": "Almaty",
  "description": "...",
  "orderNum": 1
}
```

### 3. `modules`
Store the module shell and XP gate.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "levelId": "ObjectId",
  "title": "First Steps",
  "titleKz": "Алғашқы қадамдар",
  "description": "...",
  "orderNum": 1,
  "requiredXp": 0
}
```

Indexes:
- `{ levelId: 1, orderNum: 1 }`
- `{ requiredXp: 1 }`

### 4. `units`
Store path layout and multiple landmarks directly in each unit.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "moduleId": "ObjectId",
  "title": "Family",
  "titleKz": "Отбасы",
  "subtitle": "Family · Grammar · 7 lessons",
  "icon": "family",
  "orderNum": 3,
  "lessonCount": 7,
  "pathImageUrl": "/uploads/path-maps/...png",
  "pathPoints": [{ "x": 0.1, "y": 0.2 }],
  "landmarks": [
    {
      "_id": "ObjectId",
      "imageUrl": "/uploads/landmarks/...png",
      "altText": "Kok-Tobe",
      "position": { "x": 0.72, "y": 0.33 },
      "createdAt": "..."
    }
  ]
}
```

This is a strong MongoDB fit because:
- path layout belongs only to the unit
- landmarks are edited and rendered together with the unit
- multiple landmarks per unit are now natural

Indexes:
- `{ moduleId: 1, orderNum: 1 }`

### 5. `lessons`
Keep lessons as a separate collection if admin editing and progress tracking are lesson-oriented.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "unitId": "ObjectId",
  "title": "Притяжательные окончания",
  "type": "grammar",
  "xpReward": 15,
  "orderNum": 5
}
```

Indexes:
- `{ unitId: 1, orderNum: 1 }`
- `{ type: 1 }`

### 6. `exercises`
Keep exercises separate if they are edited individually in admin and fetched by lesson.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "lessonId": "ObjectId",
  "type": "choice",
  "question": "...",
  "questionAudio": null,
  "options": ["A", "B", "C", "D"],
  "correctAnswer": "A",
  "explanation": "...",
  "orderNum": 1
}
```

Indexes:
- `{ lessonId: 1, orderNum: 1 }`

### 7. `userUnitProgress`
Keep unit progress separate because it changes often and grows by user.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "unitId": "ObjectId",
  "status": "current",
  "completedLessons": 3,
  "stars": 2,
  "updatedAt": "..."
}
```

Indexes:
- unique `{ userId: 1, unitId: 1 }`

### 8. `userLessonProgress`
Keep lesson attempts and XP accounting here.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "lessonId": "ObjectId",
  "completed": true,
  "score": 90,
  "mistakes": 1,
  "xpEarned": 18,
  "timeSpent": 140,
  "completedAt": "..."
}
```

Indexes:
- unique `{ userId: 1, lessonId: 1 }`

### 9. `userSkills`
Keep skill progress separate.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "skillName": "grammar",
  "progress": 42
}
```

Indexes:
- unique `{ userId: 1, skillName: 1 }`

### 10. `userQuests`
Keep daily quests separate because they are dynamic and user-specific.

Suggested shape:

```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "questName": "Пройти 3 микроурока",
  "questType": "lessons",
  "target": 3,
  "current": 1,
  "xpReward": 30,
  "completed": false,
  "createdAt": "..."
}
```

Indexes:
- `{ userId: 1, completed: 1, createdAt: -1 }`

## Recommended migration strategy

## Phase 1: Add MongoDB without removing PostgreSQL
Goal: prepare the backend for dual compatibility.

Tasks:
- Add `mongoose`
- Create `config/mongo.js`
- Add a feature flag:
  - `DB_PROVIDER=postgres`
  - later switch to `DB_PROVIDER=mongo`
- Introduce repository/service layer so routes stop talking directly to `pg`

Recommended first repositories:
- `authRepository`
- `moduleRepository`
- `lessonRepository`
- `progressRepository`
- `adminRepository`

This is the most important architecture step. If routes continue using SQL directly, migration will be brittle.

## Phase 2: Define Mongoose models
Create models for:
- `User`
- `Level`
- `Module`
- `Unit`
- `Lesson`
- `Exercise`
- `UserUnitProgress`
- `UserLessonProgress`
- `UserSkill`
- `UserQuest`

Important model rules:
- store `requiredXp` as Number
- store `pathPoints` and landmark `position` as subdocuments with numeric validation
- store `lesson.type` enum including `translation`, `choice`, `grammar`, `sentence`, `listening`, `speaking`
- store `exercise.type` enum independently

## Phase 3: Rewrite seed pipeline for MongoDB
Do not port SQL line by line.

Recommended approach:
- create a new file like `db/seed-mongo.js`
- define content in JS objects first
- insert levels, then modules, then units, then lessons, then exercises
- resolve ID references in memory instead of hardcoding numeric IDs

Important rule:
- stop relying on numeric lesson IDs like `32`, `43`, `54`
- use semantic lookup keys during seeding, for example:
  - `moduleKey: 'beginners-path'`
  - `unitKey: 'family'`
  - `lessonKey: 'family-speaking-story'`

This will make future curriculum refactors much safer.

## Phase 4: Move routes to repository abstraction
Current routes to migrate first:
- `routes/auth.js`
- `routes/modules.js`
- `routes/lessons.js`
- `routes/progress.js`
- `routes/admin.js`

Migration order:
1. Read-only routes first
   - levels/modules fetch
   - lesson fetch
   - dashboard fetch
2. Write routes second
   - complete lesson
   - unit layout save
   - admin CRUD
3. Seed and admin uploads last validation pass

## Phase 5: Data migration from PostgreSQL
If you want to preserve existing users and progress:
- export data from PostgreSQL using scripts, not manual SQL dumps
- create a one-time migration script:
  - read rows from PostgreSQL
  - transform to Mongo shapes
  - insert in dependency order

Suggested export order:
1. users
2. levels
3. modules
4. units
5. lessons
6. exercises
7. user progress collections
8. user skills
9. user quests

## Main code differences you must adapt

### IDs
PostgreSQL:
- integer IDs

MongoDB:
- ObjectIds

Impact:
- route params remain strings
- all repository lookups must normalize ObjectId usage
- seed code must not assume sequential numeric IDs

### joins
PostgreSQL:
- joins in SQL queries

MongoDB:
- either multiple queries or aggregation pipelines

Impact:
- `modules/:id` should fetch module, units, and user progress through repository orchestration
- avoid overusing `$lookup` for every request if plain batched queries are simpler

### transactions
PostgreSQL:
- multi-statement SQL transactions are straightforward

MongoDB:
- transactions exist, but should be used only where needed

Impact:
- lesson completion may need transaction support if you update:
  - lesson progress
  - user XP
  - unit progress
  - skills
  - quests

### JSON columns
PostgreSQL:
- `JSONB`

MongoDB:
- native nested documents

Impact:
- `path_points`
- unit `landmarks`
- exercise `options`
all become cleaner in MongoDB

## Suggested target folder structure

```text
config/
  db.js
  mongo.js
models/
  User.js
  Level.js
  Module.js
  Unit.js
  Lesson.js
  Exercise.js
  UserUnitProgress.js
  UserLessonProgress.js
  UserSkill.js
  UserQuest.js
repositories/
  authRepository.js
  moduleRepository.js
  lessonRepository.js
  progressRepository.js
  adminRepository.js
db/
  seed.js
  seed-mongo.js
  migrate-postgres-to-mongo.js
```

## Recommended implementation order for the next coding session

1. Add `mongoose` and `config/mongo.js`
2. Add `DB_PROVIDER` switch
3. Create Mongo models for content collections first
4. Create `seed-mongo.js` using semantic keys instead of numeric lesson IDs
5. Migrate read-only module and lesson routes
6. Migrate lesson completion route with XP transaction logic
7. Migrate admin unit layout and multiple landmarks routes
8. Migrate dashboard/progress routes
9. Run side-by-side verification against PostgreSQL responses
10. Switch default provider to MongoDB only after parity is confirmed

## Recommended parity checklist

Before final cutover, verify:
- login/register works
- levels and module gating by `requiredXp` works
- module page path renders correctly
- multiple landmarks render and save correctly
- grammar lessons display as grammar
- lesson completion does not double-award XP
- daily quests remain visible after completion
- next unit unlock works
- rating page still sorts by XP
- admin CRUD works for levels/modules/units/lessons/exercises

## Practical recommendation

Do not try to replace PostgreSQL and content architecture in one step.

Best path:
- keep current PostgreSQL app stable
- finish repository abstraction
- create Mongo seed and Mongo read routes
- validate parity
- then switch writes

That will be much safer than rewriting the whole backend directly inside existing route files.

## Current implementation status

Implemented in code:
- `mongoose` dependency added
- `config/mongo.js` added for lazy MongoDB connection
- `db/bootstrap.js` bootstraps MongoDB only
- `moduleRepository.js`, `lessonRepository.js`, `progressRepository.js`, `authRepository.js`, and `adminRepository.js` now run on MongoDB-only runtime paths
- PostgreSQL package usage, scripts, and old bootstrap/seed files were removed from active backend runtime
- `routes/auth.js`, `routes/modules.js`, `routes/lessons.js`, `routes/progress.js`, and `routes/admin.js` use the Mongo-backed repository layer

Current local run:
1. Keep local MongoDB running
2. Set `MONGODB_URI=mongodb://127.0.0.1:27017/kazakh_learn`
3. Run `npm run db:init`
4. Run `npm run db:seed`
5. Start the backend and validate auth, modules, lessons, progress, and admin CRUD
