'use strict';

let search;
let profile;
let post;
let home;

function getSearch() { return search || (search = require('../../scripts/x-search')); }
function getProfile() { return profile || (profile = require('../../scripts/x-profile')); }
function getPost_() { return post || (post = require('../../scripts/x-post')); }
function getHome() { return home || (home = require('../../scripts/x-home')); }

module.exports = { getSearch, getProfile, getPost_, getHome };
