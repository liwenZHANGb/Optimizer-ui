package com.lwoptimizer.ui.service;

import com.lwoptimizer.ui.api.dto.JobDto;
import com.lwoptimizer.ui.api.dto.Snapshot;

import java.util.ArrayList;
import java.util.List;
import java.util.function.IntFunction;

/**
 * One optimization run: its snapshots, in the order they were found, and how it ended.
 * Written by the solving thread, read by HTTP threads.
 *
 * <p>Improvements can come by the hundreds per second at the start of a search. They are
 * thinned out so that at most one snapshot is kept every {@value #MIN_INTERVAL_MILLIS} ms;
 * the latest one is never lost, it is only published a little later.
 */
public final class Job<P> {

    static final long MIN_INTERVAL_MILLIS = 12;

    public enum State { RUNNING, DONE, FAILED }

    private final String id;
    private final String engine;
    private final List<Snapshot<P>> snapshots = new ArrayList<>();
    private IntFunction<Snapshot<P>> pending;
    private long lastPublishMillis;
    private State state = State.RUNNING;
    private String terminationReason;
    private String error;
    private Runnable stopper = () -> { };

    Job(String id, String engine) {
        this.id = id;
        this.engine = engine;
    }

    public String id() {
        return id;
    }

    /** Offers a new best plan; it is published now, or shortly if the previous one is too recent. */
    synchronized void offer(IntFunction<Snapshot<P>> snapshot) {
        if (System.currentTimeMillis() - lastPublishMillis >= MIN_INTERVAL_MILLIS) {
            publish(snapshot);
        } else {
            pending = snapshot;
        }
    }

    /** Publishes what {@link #offer} held back. */
    synchronized void flush() {
        if (pending != null) {
            publish(pending);
        }
    }

    private void publish(IntFunction<Snapshot<P>> snapshot) {
        snapshots.add(snapshot.apply(snapshots.size()));
        pending = null;
        lastPublishMillis = System.currentTimeMillis();
        notifyAll();
    }

    synchronized void complete(IntFunction<Snapshot<P>> last, String terminationReason) {
        pending = null;
        publish(last);
        this.terminationReason = terminationReason;
        this.state = State.DONE;
        notifyAll();
    }

    synchronized void fail(String error) {
        this.error = error;
        this.state = State.FAILED;
        notifyAll();
    }

    synchronized void onStop(Runnable stopper) {
        this.stopper = stopper;
    }

    /** Asks the solver to stop and return its best plan. */
    public void stop() {
        Runnable stop;
        synchronized (this) {
            stop = stopper;
        }
        stop.run();
    }

    public synchronized boolean isRunning() {
        return state == State.RUNNING;
    }

    /**
     * The snapshots from the given index on, waiting up to {@code waitMillis} for one to
     * arrive if there is none yet and the job is still running.
     */
    public synchronized List<Snapshot<P>> snapshotsFrom(int index, long waitMillis) throws InterruptedException {
        if (index >= snapshots.size() && state == State.RUNNING) {
            wait(waitMillis);
            flush();
        }
        return new ArrayList<>(snapshots.subList(Math.min(index, snapshots.size()), snapshots.size()));
    }

    public synchronized JobDto<P> describe() {
        return new JobDto<>(id, state.name(), engine, terminationReason, error, snapshots.size(),
                snapshots.isEmpty() ? null : snapshots.get(snapshots.size() - 1));
    }
}
