delete window.$;
let wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, (r) => r]);
webpackChunkdiscord_app.pop();

let ApplicationStreamingStore = Object.values(wpRequire.c).find((x) => x?.exports?.Z?.__proto__?.getStreamerActiveStreamMetadata)?.exports?.Z;
let RunningGameStore, QuestsStore, ChannelStore, GuildChannelStore, FluxDispatcher, api;
if (!ApplicationStreamingStore) {
	ApplicationStreamingStore = Object.values(wpRequire.c).find((x) => x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata).exports.A;
	RunningGameStore = Object.values(wpRequire.c).find((x) => x?.exports?.Ay?.getRunningGames).exports.Ay;
	QuestsStore = Object.values(wpRequire.c).find((x) => x?.exports?.A?.__proto__?.getQuest).exports.A;
	ChannelStore = Object.values(wpRequire.c).find((x) => x?.exports?.A?.__proto__?.getAllThreadsForParent).exports.A;
	GuildChannelStore = Object.values(wpRequire.c).find((x) => x?.exports?.Ay?.getSFWDefaultChannel).exports.Ay;
	FluxDispatcher = Object.values(wpRequire.c).find((x) => x?.exports?.h?.__proto__?.flushWaitQueue).exports.h;
	api = Object.values(wpRequire.c).find((x) => x?.exports?.Bo?.get).exports.Bo;
} else {
	RunningGameStore = Object.values(wpRequire.c).find((x) => x?.exports?.ZP?.getRunningGames).exports.ZP;
	QuestsStore = Object.values(wpRequire.c).find((x) => x?.exports?.Z?.__proto__?.getQuest).exports.Z;
	ChannelStore = Object.values(wpRequire.c).find((x) => x?.exports?.Z?.__proto__?.getAllThreadsForParent).exports.Z;
	GuildChannelStore = Object.values(wpRequire.c).find((x) => x?.exports?.ZP?.getSFWDefaultChannel).exports.ZP;
	FluxDispatcher = Object.values(wpRequire.c).find((x) => x?.exports?.Z?.__proto__?.flushWaitQueue).exports.Z;
	api = Object.values(wpRequire.c).find((x) => x?.exports?.tn?.get).exports.tn;
}

const supportedTasks = ['WATCH_VIDEO', 'PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY', 'WATCH_VIDEO_ON_MOBILE'];
const EXCLUDED_QUEST_IDS = new Set(['1412491570820812933']);
const REQUEST_CONFIG = {
	minGapMs: 450,
	jitterMs: 350,
	maxRetries: 6,
	baseBackoffMs: 1200,
	maxBackoffMs: 30000,
};

let nextRequestAt = 0;
if (typeof globalThis.__quest_isApp === 'undefined') globalThis.__quest_isApp = typeof DiscordNative !== 'undefined';
let isApp = globalThis.__quest_isApp;

(async () => {
	const allQuests = await getAllQuests();
	const quests = allQuests.filter((q) => !EXCLUDED_QUEST_IDS.has(q.id) && isRunnableQuest(q));

	if (quests.length === 0) {
		console.log("You don't have any uncompleted quests!");
		return;
	}

	const unclaimedCount = quests.filter((q) => !q.userStatus?.enrolledAt).length;
	console.log(`Found ${allQuests.length} total quest(s), ${quests.length} runnable. Unclaimed: ${unclaimedCount}. Enrolling then starting concurrently...`);
	runAllConcurrently(quests).catch((err) => console.error(err));
})();

function isRunnableQuest(quest) {
	const userStatus = quest.userStatus ?? quest.user_status ?? {};
	const config = quest.config ?? {};
	const completedAt = userStatus.completedAt ?? userStatus.completed_at;
	const expiresAt = config.expiresAt ?? config.expires_at;

	if (completedAt) return false;
	if (!expiresAt) return true;

	const expiryTs = new Date(expiresAt).getTime();
	if (Number.isNaN(expiryTs)) return true;

	return expiryTs > Date.now();
}

function normalizeQuest(rawQuest) {
	const config = rawQuest?.config ?? {};
	const userStatus = rawQuest?.userStatus ?? rawQuest?.user_status ?? {};
	const taskConfig = config.taskConfig ?? config.task_config ?? config.taskConfigV2 ?? config.task_config_v2;

	const application = config.application ?? config.application_config ?? {};
	const messages = config.messages ?? { questName: config.messages?.questName ?? config.messages?.quest_name ?? rawQuest?.name ?? rawQuest?.id ?? 'Unknown Quest' };

	return {
		...rawQuest,
		config: {
			...config,
			expiresAt: config.expiresAt ?? config.expires_at,
			taskConfig,
			taskConfigV2: config.taskConfigV2 ?? config.task_config_v2,
			application: {
				id: application.id ?? application.application_id,
				name: application.name ?? application.display_name ?? rawQuest?.application?.name ?? 'Unknown Application',
				...application,
			},
			messages: {
				questName: messages.questName ?? messages.quest_name ?? rawQuest?.name ?? rawQuest?.id ?? 'Unknown Quest',
				...messages,
			},
		},
		userStatus: normalizeUserStatus(userStatus),
	};
}

function normalizeUserStatus(rawStatus) {
	const userStatus = rawStatus?.userStatus ?? rawStatus?.user_status ?? rawStatus ?? {};

	return {
		...userStatus,
		enrolledAt: userStatus.enrolledAt ?? userStatus.enrolled_at,
		completedAt: userStatus.completedAt ?? userStatus.completed_at,
		progress: userStatus.progress ?? {},
		streamProgressSeconds: userStatus.streamProgressSeconds ?? userStatus.stream_progress_seconds,
	};
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(error) {
	const retryAfterRaw = error?.body?.retry_after ?? error?.retry_after ?? error?.headers?.['retry-after'] ?? error?.response?.headers?.['retry-after'];
	if (retryAfterRaw == null) return null;

	const retryAfterNum = Number(retryAfterRaw);
	if (Number.isNaN(retryAfterNum) || retryAfterNum <= 0) return null;

	return retryAfterNum <= 120 ? retryAfterNum * 1000 : retryAfterNum;
}

async function runRateLimitedRequest(requestFn, label) {
	for (let attempt = 0; attempt <= REQUEST_CONFIG.maxRetries; attempt++) {
		const waitForSlot = Math.max(0, nextRequestAt - Date.now());
		if (waitForSlot > 0) await sleep(waitForSlot);

		try {
			const response = await requestFn();
			nextRequestAt = Date.now() + REQUEST_CONFIG.minGapMs + Math.floor(Math.random() * REQUEST_CONFIG.jitterMs);
			return response;
		} catch (error) {
			const retryAfterMs = getRetryAfterMs(error);
			const backoffMs = retryAfterMs ?? Math.min(REQUEST_CONFIG.maxBackoffMs, REQUEST_CONFIG.baseBackoffMs * 2 ** attempt) + Math.floor(Math.random() * REQUEST_CONFIG.jitterMs);
			nextRequestAt = Date.now() + backoffMs;

			if (attempt >= REQUEST_CONFIG.maxRetries) {
				throw error;
			}

			console.warn(`[request] ${label} failed (status=${error?.status ?? 'unknown'}) retrying in ${backoffMs}ms (attempt ${attempt + 1}/${REQUEST_CONFIG.maxRetries})`);
			await sleep(backoffMs);
		}
	}
}

async function apiGet(url, label = url) {
	return runRateLimitedRequest(() => api.get({ url }), `GET ${label}`);
}

async function apiPost(url, body, label = url) {
	return runRateLimitedRequest(() => api.post({ url, body }), `POST ${label}`);
}

async function getAllQuests() {
	const byId = new Map();

	try {
		const storeQuests = [...QuestsStore.quests.values()];
		for (const quest of storeQuests) {
			if (quest?.id) byId.set(quest.id, normalizeQuest(quest));
		}
	} catch (e) {
		console.warn('Failed to read quests from store:', e);
	}

	try {
		const res = await apiGet('/quests/@me', '/quests/@me');
		const body = res?.body;
		const apiQuests = Array.isArray(body) ? body : Array.isArray(body?.quests) ? body.quests : [];

		for (const quest of apiQuests) {
			if (quest?.id) {
				const normalizedQuest = normalizeQuest(quest);
				byId.set(quest.id, {
					...byId.get(quest.id),
					...normalizedQuest,
				});
			}
		}
	} catch (e) {
		console.warn('Failed to fetch /quests/@me, using store cache only:', e);
	}

	return [...byId.values()];
}

async function syncQuestStatuses(questsToSync) {
	if (!Array.isArray(questsToSync) || questsToSync.length === 0) return;

	try {
		const res = await apiGet('/quests/@me', '/quests/@me (sync)');
		const body = res?.body;
		const apiQuests = Array.isArray(body) ? body : Array.isArray(body?.quests) ? body.quests : [];
		const byId = new Map(apiQuests.filter((q) => q?.id).map((q) => [q.id, normalizeQuest(q)]));

		for (const quest of questsToSync) {
			const synced = byId.get(quest.id);
			if (!synced) continue;

			quest.userStatus = {
				...quest.userStatus,
				...normalizeUserStatus(synced.userStatus),
			};
		}
	} catch (e) {
		console.warn('Failed to sync quest statuses from /quests/@me:', e);
	}
}

async function runAllConcurrently(quests) {
	// Enroll in any quests we're not already enrolled in
	await Promise.all(
		quests.map(async (q) => {
			if (!q.userStatus?.enrolledAt) {
				try {
					const res = await apiPost(`/quests/${q.id}/enroll`, { location: 0 }, `/quests/${q.id}/enroll`);
					// update local quest userStatus with response
					if (res?.body) {
						q.userStatus = {
							...q.userStatus,
							...normalizeUserStatus(res.body),
						};
					}
					console.log(`Enrolled in: ${q.config.messages.questName}`);
				} catch (e) {
					console.warn(`Failed to enroll in ${q.config.messages.questName}:`, e);
				}
			}
		}),
	);

	const stillMissingEnrollment = quests.filter((q) => !q.userStatus?.enrolledAt);
	if (stillMissingEnrollment.length > 0) {
		console.warn(`Syncing enrollment status for ${stillMissingEnrollment.length} quest(s) missing enrolledAt...`);
		await syncQuestStatuses(stillMissingEnrollment);
	}

	// Global patches to allow multiple concurrent fake games/streams
	const originalGetRunningGames = RunningGameStore.getRunningGames;
	const originalGetGameForPID = RunningGameStore.getGameForPID;
	const originalGetStreamer = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

	let activeFakeGames = [];
	let activeStreams = [];

	RunningGameStore.getRunningGames = () => {
		try {
			const real = originalGetRunningGames ? originalGetRunningGames() : [];
			return real.concat(activeFakeGames);
		} catch (e) {
			return activeFakeGames.slice();
		}
	};

	RunningGameStore.getGameForPID = (pid) => {
		return activeFakeGames.find((g) => g.pid === pid) || (originalGetGameForPID ? originalGetGameForPID(pid) : null);
	};

	ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => {
		if (activeStreams.length > 0) return activeStreams[0];
		try {
			return originalGetStreamer ? originalGetStreamer() : null;
		} catch (e) {
			return null;
		}
	};

	// Start all quests concurrently
	const promises = quests.map((q) =>
		runQuest(q, {
			addFakeGame: (g) => {
				activeFakeGames.push(g);
				FluxDispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', removed: [], added: [g], games: [g] });
			},
			removeFakeGame: (g) => {
				activeFakeGames = activeFakeGames.filter((x) => x.pid !== g.pid);
				FluxDispatcher.dispatch({ type: 'RUNNING_GAMES_CHANGE', removed: [g], added: [], games: [] });
			},
			addStream: (s) => {
				activeStreams.push(s);
				FluxDispatcher.dispatch({ type: 'STREAMS_CHANGED', added: [s], removed: [] });
			},
			removeStream: (s) => {
				activeStreams = activeStreams.filter((x) => x.pid !== s.pid);
				FluxDispatcher.dispatch({ type: 'STREAMS_CHANGED', added: [], removed: [s] });
			},
		}),
	);

	const results = await Promise.allSettled(promises);

	// restore originals
	RunningGameStore.getRunningGames = originalGetRunningGames;
	RunningGameStore.getGameForPID = originalGetGameForPID;
	ApplicationStreamingStore.getStreamerActiveStreamMetadata = originalGetStreamer;

	console.log('All quests processed. Summary:');
	results.forEach((r, i) => {
		const q = quests[i];
		if (r.status === 'fulfilled') console.log(`- ${q.config.messages.questName}: success`);
		else console.log(`- ${q.config.messages.questName}: failed ->`, r.reason);
	});
}

async function runQuest(quest, registry) {
	const pid = Math.floor(Math.random() * 30000) + 1000;
	const applicationId = quest.config.application.id;
	const applicationName = quest.config.application.name;
	const questName = quest.config.messages.questName;
	const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
	if (!taskConfig || !taskConfig.tasks) {
		console.log(`Quest ${questName}: missing task configuration — not supported.`);
		return;
	}
	const taskName = supportedTasks.find((x) => taskConfig.tasks && taskConfig.tasks[x] != null);
	if (!taskName) {
		console.log(`Quest ${questName}: task type not supported — available: ${Object.keys(taskConfig.tasks).join(', ')}`);
		return;
	}
	const secondsNeeded = taskConfig.tasks[taskName].target;
	let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

	console.log(`--- Starting Quest: ${questName} (${taskName}) ---`);

	if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
		const maxFuture = 10;
		const speed = 7;
		const intervalMs = 1000;
		let enrolledAt = new Date(quest.userStatus?.enrolledAt).getTime();
		if (!Number.isFinite(enrolledAt) || enrolledAt <= 0) {
			console.warn(`[${questName}] enrolledAt missing/invalid after enroll; syncing status before WATCH...`);
			await syncQuestStatuses([quest]);
			enrolledAt = new Date(quest.userStatus?.enrolledAt).getTime();

			if (!Number.isFinite(enrolledAt) || enrolledAt <= 0) {
				enrolledAt = Date.now() - 15000;
				console.warn(`[${questName}] using fallback enrolledAt for WATCH progression.`);
			}
		}

		console.log(`[${questName}] WATCH task starting: target=${secondsNeeded}, current=${secondsDone}`);

		let completed = false;
		while (secondsDone < secondsNeeded) {
			const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
			const diff = maxAllowed - secondsDone;
			const timestamp = Math.min(secondsNeeded, secondsDone + speed);

			if (diff >= speed) {
				try {
					const res = await apiPost(`/quests/${quest.id}/video-progress`, { timestamp: Math.min(secondsNeeded, timestamp + Math.random()) }, `/quests/${quest.id}/video-progress`);

					const newProgress = res.body?.progress?.WATCH_VIDEO?.value ?? res.body?.progress?.WATCH_VIDEO_ON_MOBILE?.value ?? null;
					if (newProgress != null) {
						secondsDone = Math.max(secondsDone, Math.floor(newProgress));
					} else {
						secondsDone = timestamp;
					}

					completed = res.body?.completed_at != null || secondsDone >= secondsNeeded;
					console.log(`[${questName}] video-progress -> ${secondsDone}/${secondsNeeded}`);
				} catch (e) {
					console.warn(`[${questName}] video-progress error:`, e);
				}
			}

			if (completed || secondsDone >= secondsNeeded) break;
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
		}

		if (!completed) {
			try {
				await apiPost(`/quests/${quest.id}/video-progress`, { timestamp: secondsNeeded }, `/quests/${quest.id}/video-progress-final`);
			} catch (e) {
				console.warn(`[${questName}] final video-progress error:`, e);
			}
		}

		console.log(`Done (video): ${questName}`);
		return;
	} else if (taskName === 'PLAY_ON_DESKTOP') {
		if (!isApp) {
			console.log('This no longer works in browser for non-video quests. Use the discord desktop app to complete the', questName, 'quest!');
			return;
		}

		const res = await apiGet(`/applications/public?application_ids=${applicationId}`, `/applications/public?application_ids=${applicationId}`);
		const appData = res.body[0];
		const exeName = appData.executables?.find((x) => x.os === 'win32')?.name?.replace('>', '') ?? appData.name.replace(/[\/\\:*?"<>|]/g, '');
		const fakeGame = {
			cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
			exeName,
			exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
			hidden: false,
			isLauncher: false,
			id: applicationId,
			name: appData.name,
			pid: pid,
			pidPath: [pid],
			processName: appData.name,
			start: Date.now(),
		};

		// register fake game globally
		registry.addFakeGame(fakeGame);

		try {
			// Poll quest heartbeat directly so each PLAY_ON_DESKTOP quest advances independently
			while (true) {
				try {
					const res = await apiPost(`/quests/${quest.id}/heartbeat`, {}, `/quests/${quest.id}/heartbeat`);
					const progress = quest.config.configVersion === 1 ? (res.body?.streamProgressSeconds ?? 0) : Math.floor(res.body?.progress?.PLAY_ON_DESKTOP?.value ?? 0);
					console.log(`[${questName}] Progress: ${progress}/${secondsNeeded}`);
					if (progress >= secondsNeeded) break;
				} catch (e) {
					console.warn(`[${questName}] heartbeat error:`, e);
				}
				await sleep(9000 + Math.floor(Math.random() * 3000));
			}
			console.log(`Done (play desktop): ${questName}`);
		} finally {
			registry.removeFakeGame(fakeGame);
		}
		return;
	} else if (taskName === 'STREAM_ON_DESKTOP') {
		if (!isApp) {
			console.log('This no longer works in browser for non-video quests. Use the discord desktop app to complete the', questName, 'quest!');
			return;
		}

		const streamMeta = { id: applicationId, pid, sourceName: null };
		registry.addStream(streamMeta);

		try {
			// Poll heartbeat directly so multiple STREAM_ON_DESKTOP quests advance independently
			while (true) {
				try {
					const res = await apiPost(`/quests/${quest.id}/heartbeat`, {}, `/quests/${quest.id}/heartbeat`);
					const progress = quest.config.configVersion === 1 ? (res.body?.streamProgressSeconds ?? 0) : Math.floor(res.body?.progress?.STREAM_ON_DESKTOP?.value ?? 0);
					console.log(`[${questName}] Progress: ${progress}/${secondsNeeded}`);
					if (progress >= secondsNeeded) break;
				} catch (e) {
					console.warn(`[${questName}] heartbeat error:`, e);
				}
				await sleep(9000 + Math.floor(Math.random() * 3000));
			}
			console.log(`Done (stream desktop): ${questName}`);
		} finally {
			registry.removeStream(streamMeta);
		}
		return;
	} else if (taskName === 'PLAY_ACTIVITY') {
		const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find((x) => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id;
		const streamKey = `call:${channelId}:1`;

		while (true) {
			const res = await apiPost(`/quests/${quest.id}/heartbeat`, { stream_key: streamKey, terminal: false }, `/quests/${quest.id}/heartbeat-activity`);
			const progress = res.body?.progress?.PLAY_ACTIVITY?.value ?? 0;
			console.log(`[${questName}] Quest progress: ${progress}/${secondsNeeded}`);

			if (progress >= secondsNeeded) {
				await apiPost(`/quests/${quest.id}/heartbeat`, { stream_key: streamKey, terminal: true }, `/quests/${quest.id}/heartbeat-activity-terminal`);
				console.log(`Done (play activity): ${questName}`);
				break;
			}

			await sleep(19000 + Math.floor(Math.random() * 3000));
		}
		return;
	}

	console.log(`Task ${taskName} for ${questName} not handled.`);
}
