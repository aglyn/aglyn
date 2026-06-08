
#*
# @license
# Copyright 2022 Aglyn LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#*

# Name of the app to check. Change this to your application name!
APP=$CURRENT_APP

# Determine version of Nx installed
NX_VERSION=$(node -e "console.log(require('./package.json').devDependencies['@nx/workspace'])")
TS_VERSION=$(node -e "console.log(require('./package.json').devDependencies['typescript'])")

# Install @nx/workspace in order to run the affected command
npm install -D @nx/workspace@$NX_VERSION --prefer-offline
npm install -D typescript@$TS_VERSION --prefer-offline

# Run the affected command, comparing latest commit to the one before that
npx nx affected:apps --plain --base=$NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA --head HEAD | grep $APP -q

# Store result of the previous command (grep)
IS_AFFECTED=$?

if [ $IS_AFFECTED -eq 1 ]; then
  echo "🛑 - Build cancelled"
  exit 0
elif [ $IS_AFFECTED -eq 0 ]; then
  echo "✅ - Build can proceed"
  exit 1
fi
