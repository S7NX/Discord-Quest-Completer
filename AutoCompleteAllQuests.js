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

// collect all eligible quests
// collect all quests that are not completed and not expired (we will enroll missing ones)
let quests = [...QuestsStore.quests.values()].filter((x) => x.id !== '1412491570820812933' && !x.userStatus?.completedAt && new Date(x.config.expiresAt).getTime() > Date.now());

if (typeof globalThis.__quest_isApp === 'undefined') globalThis.__quest_isApp = typeof DiscordNative !== 'undefined';

if (quests.length === 0) {
	console.log("You don't have any uncompleted quests!");
} else {
	console.log(`Found ${quests.length} quest(s) to accept and complete. Enrolling then starting concurrently...`);
	runAllConcurrently(quests).catch((err) => console.error(err));
}

async function runAllConcurrently(quests) {
	// Enroll in any quests we're not already enrolled in
	await Promise.all(
		quests.map(async (q) => {
			if (!q.userStatus?.enrolledAt) {
				try {
					const res = await api.post({ url: `/quests/${q.id}/enroll`, body: { location: 0 } });
					// update local quest userStatus with response
					if (res?.body) q.userStatus = res.body;
					console.log(`Enrolled in: ${q.config.messages.questName}`);
				} catch (e) {
					console.warn(`Failed to enroll in ${q.config.messages.questName}:`, e);
				}
			}
		}),
	);

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
	const taskName = ['WATCH_VIDEO', 'PLAY_ON_DESKTOP', 'STREAM_ON_DESKTOP', 'PLAY_ACTIVITY', 'WATCH_VIDEO_ON_MOBILE'].find((x) => taskConfig.tasks && taskConfig.tasks[x] != null);
	if (!taskName) {
		console.log(`Quest ${questName}: task type not supported — available: ${Object.keys(taskConfig.tasks).join(', ')}`);
		return;
	}
	const secondsNeeded = taskConfig.tasks[taskName].target;
	let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

	console.log(`--- Starting Quest: ${questName} (${taskName}) ---`);

	if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
		// Watch video progress in real-time - take the actual time needed to watch
		// Send incremental updates approximately every 5-10s so it looks natural

		console.log(`[${questName}] WATCH task starting: target=${secondsNeeded}, current=${secondsDone}`);

		const updateIntervalMs = 5000 + Math.floor(Math.random() * 5000); // 5-10s between updates for naturalness
		const secondsPerUpdate = Math.random() * 3 + 2; // 2-5 seconds of progress per update

		let completed = false;
		while (secondsDone < secondsNeeded) {
			// Calculate how much time has actually passed and advance accordingly
			const toAdd = Math.min(secondsPerUpdate, secondsNeeded - secondsDone);
			const ts = Math.min(secondsNeeded, secondsDone + toAdd);
			try {
				const res = await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: ts } });
				const newProgress = res.body?.progress?.WATCH_VIDEO?.value ?? res.body?.progress?.WATCH_VIDEO_ON_MOBILE?.value ?? null;
				if (newProgress != null) secondsDone = Math.max(secondsDone, newProgress);
				completed = res.body?.completed_at != null || secondsDone >= secondsNeeded;
				console.log(`[${questName}] video-progress -> ${secondsDone}/${secondsNeeded} (${Math.round((secondsDone / secondsNeeded) * 100)}%)`);
			} catch (e) {
				console.warn(`[${questName}] video-progress error:`, e);
			}

			if (completed || secondsDone >= secondsNeeded) break;
			// Sleep for the actual time that would be spent watching
			await new Promise((r) => setTimeout(r, updateIntervalMs));
		}

		// ensure finalization
		if (!completed && secondsDone < secondsNeeded) {
			try {
				await api.post({ url: `/quests/${quest.id}/video-progress`, body: { timestamp: secondsNeeded } });
			} catch (e) {
				console.warn(`[${questName}] final video-progress error:`, e);
			}
		}

		console.log(`Done (video): ${questName}`);
		return;	
	} else if (taskName === 'PLAY_ON_DESKTOP') {
		if (!globalThis.__quest_isApp) {
			console.log(`Skipping ${questName}: Desktop app required.`);
			return;
		}

		const res = await api.get({ url: `/applications/public?application_ids=${applicationId}` });
		const appData = res.body[0];
		
		// Fix: Added optional chaining (?.) and default empty array [] to avoid crashing if executables is missing
		const exeName = (appData?.executables?.find((x) => x.os === 'win32')?.name || '').replace('>', '');
		
		const fakeGame = {
			cmdLine: `C:\\Program Files\\${appData.name}\\${exeName}`,
			exeName,
			exePath: `c:/program files/${appData.name.toLowerCase()}/${exeName}`,
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
			// Use realistic heartbeat intervals - heartbeat every 30-45 seconds for natural appearance
			let retryCount = 0;
			const heartbeatIntervalMs = 30000 + Math.floor(Math.random() * 15000); // 30-45s between heartbeats
			const startTime = Date.now();

			while (true) {
				try {
					const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: {} });
					const progress = res.body?.progress?.PLAY_ON_DESKTOP?.value ?? 0;
					const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
					console.log(`[${questName}] Progress: ${progress}/${secondsNeeded} (elapsed: ${elapsedSeconds}s)`);
					retryCount = 0;
					if (progress >= secondsNeeded) break;
				} catch (e) {
					if (e.status === 429) {
						const retryAfter = (e.body?.retry_after || 1) * 1000;
						console.warn(`[${questName}] rate limited, waiting ${retryAfter}ms`);
						await new Promise((r) => setTimeout(r, retryAfter + Math.random() * 1000));
						continue;
					}
					retryCount++;
					if (retryCount > 3) {
						console.warn(`[${questName}] heartbeat error after ${retryCount} retries:`, e);
						break;
					}
					console.warn(`[${questName}] heartbeat error (retry ${retryCount}/3):`, e.status);
				}
				// Wait between heartbeats - realistic interval for a playing game
				await new Promise((r) => setTimeout(r, heartbeatIntervalMs));
			}
			console.log(`Done (play desktop): ${questName}`);
		} finally {
			registry.removeFakeGame(fakeGame);
		}
		return;
	} else if (taskName === 'STREAM_ON_DESKTOP') {
		if (!globalThis.__quest_isApp) {
			console.log(`Skipping ${questName}: Desktop app required.`);
			return;
		}

		const streamMeta = { id: applicationId, pid, sourceName: null };
		registry.addStream(streamMeta);

		try {
			// Poll heartbeat directly so multiple STREAM_ON_DESKTOP quests advance independently
			// Use realistic heartbeat intervals - heartbeat every 30-45 seconds for natural appearance
			let retryCount = 0;
			const heartbeatIntervalMs = 30000 + Math.floor(Math.random() * 15000); // 30-45s between heartbeats
			const startTime = Date.now();

			while (true) {
				try {
					const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: {} });
					const progress = res.body?.progress?.STREAM_ON_DESKTOP?.value ?? 0;
					const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
					console.log(`[${questName}] Progress: ${progress}/${secondsNeeded} (elapsed: ${elapsedSeconds}s)`);
					retryCount = 0;
					if (progress >= secondsNeeded) break;
				} catch (e) {
					if (e.status === 429) {
						const retryAfter = (e.body?.retry_after || 1) * 1000;
						console.warn(`[${questName}] rate limited, waiting ${retryAfter}ms`);
						await new Promise((r) => setTimeout(r, retryAfter + Math.random() * 1000));
						continue;
					}
					retryCount++;
					if (retryCount > 3) {
						console.warn(`[${questName}] heartbeat error after ${retryCount} retries:`, e);
						break;
					}
					console.warn(`[${questName}] heartbeat error (retry ${retryCount}/3):`, e.status);
				}
				// Wait between heartbeats - realistic interval for a streaming session
				await new Promise((r) => setTimeout(r, heartbeatIntervalMs));
			}
			console.log(`Done (stream desktop): ${questName}`);
		} finally {
			registry.removeStream(streamMeta);
		}
		return;
	} else if (taskName === 'PLAY_ACTIVITY') {
		const channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find((x) => x != null && x.VOCAL.length > 0).VOCAL[0].channel.id;
		const streamKey = `call:${channelId}:1`;
		const startTime = Date.now();

		while (true) {
			const res = await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: false } });
			const progress = res.body?.progress?.PLAY_ACTIVITY?.value ?? 0;
			const elapsedSeconds = Math.round((Date.now() - startTime) / 1000);
			console.log(`[${questName}] Quest progress: ${progress}/${secondsNeeded} (elapsed: ${elapsedSeconds}s)`);

			if (progress >= secondsNeeded) {
				await api.post({ url: `/quests/${quest.id}/heartbeat`, body: { stream_key: streamKey, terminal: true } });
				console.log(`Done (play activity): ${questName}`);
				break;
			}

			// Natural heartbeat interval for activity participation (20-30 seconds)
			await new Promise((resolve) => setTimeout(resolve, 20 * 1000 + Math.random() * 10000));
		}
		return;
	}

	console.log(`Task ${taskName} for ${questName} not handled.`);
}
