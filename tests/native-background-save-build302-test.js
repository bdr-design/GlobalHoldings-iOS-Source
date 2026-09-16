'use strict';
const fs=require('fs'),assert=require('assert');
const controller=fs.readFileSync('iOS/GlobalHoldings/GameViewController.swift','utf8');
const delegate=fs.readFileSync('iOS/GlobalHoldings/AppDelegate.swift','utf8');
const app=fs.readFileSync('WebApp/app.js','utf8');

assert(delegate.includes('applicationDidEnterBackground')&&delegate.includes('persistStateForBackground(application)'),'app lifecycle does not request a background save');
assert(controller.includes('beginBackgroundTask(withName: "GlobalHoldings.Save")'),'finite iOS background task is missing');
assert(controller.includes('application.endBackgroundTask(task)'),'iOS background task is not ended');
assert(controller.includes('token == backgroundSaveToken'),'late completion can end a newer background task');
assert(controller.includes('callAsyncJavaScript')&&controller.includes('persistForBackground'),'native does not await the browser save pipeline');
assert(app.includes('persistForBackground:async()=>')&&app.includes('await window.GH_PERSISTENCE.drain()'),'browser background save does not await Native Save Vault acknowledgement');
console.log('Native background save lifecycle Build302: PASS');
